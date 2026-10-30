import { type Corner, cornerLabel, type Device, isCorner, type StartWalkRequest, type Tag } from "@emberwalk/shared";
import type { Failure, Fetch, UploadApi, WalkApi } from "./api.ts";
import type { Jurisdiction } from "./location.ts";
import { partsOf } from "./parts.ts";
import { IDEAL_SIZE, UNKNOWN_CAMERA } from "./recorder.ts";
import type { Pan, Take, TakeStore } from "./take-store.ts";
import { sendTake, walkOnly } from "./uploader.ts";
import type { Progress, SendResult } from "./uploader.ts";

export type Sender = (take: Take, onProgress: (progress: Progress) => void) => Promise<SendResult>;

export type SenderDeps = {
  walks: WalkApi;
  uploads: UploadApi;
  put: Fetch;
  takes: () => Promise<TakeStore>;
  visitorId: () => string;
  newId?: () => string;
  abort?: (uploadId: string) => Promise<unknown>;
};

export const FALLBACK_RULES: Jurisdiction = "ca";

const UNKNOWN_DEVICE: Device = { camera: UNKNOWN_CAMERA, ...IDEAL_SIZE };

export const walkRequest = (take: Take, visitorId: string): StartWalkRequest => ({
  partOf: take.partOf ?? null,
  language: "en",
  jurisdiction: take.jurisdiction ?? FALLBACK_RULES,
  device: take.device ?? UNKNOWN_DEVICE,
  synthetic: false,
  visitorId,
  startKey: take.id,
});

type Stretch = { kind: Tag["kind"]; side: string | null; startSeconds: number; endSeconds: number; last: boolean };

const within = ({ t }: { t: number }, stretch: Stretch): boolean =>
  t >= stretch.startSeconds && (t < stretch.endSeconds || (stretch.last && t === stretch.endSeconds));

const walkTags = (take: Take, walkId: string, stretches: readonly Stretch[], ids: readonly string[]): Tag[] =>
  stretches.map((stretch, i) => {
    const light = (take.marks.light ?? []).filter((reading) => within(reading, stretch));
    return {
      id: ids[i] as string,
      walkId,
      kind: stretch.kind,
      startSeconds: stretch.startSeconds,
      endSeconds: stretch.endSeconds,
      label: stretch.side ?? "Walk",
      samples: take.marks.motion.filter((sample) => within(sample, stretch)),
      ...(light.length === 0 ? {} : { light }),
      propertyLine: null,
    };
  });

const loopParts = (take: Take, endMs: number): Omit<Stretch, "kind" | "last">[] => {
  const parts = partsOf(endMs, take.marks.motion, take.marks.nextTaps ?? []);
  const side = take.partOf?.side;
  return side === undefined || parts.length === 0 ? parts : [{ side, startSeconds: 0, endSeconds: parts.at(-1)!.endSeconds }];
};

const cornerPart = (take: Take): Corner | null => {
  const side = take.partOf?.side;
  return side !== undefined && isCorner(side) ? side : null;
};

const marksOf = (take: Take, durationMs: number): Pan[] => {
  const marked = take.marks.pans ?? [];
  const corner = cornerPart(take);
  if (corner === null || marked.length > 0 || durationMs <= 0) return marked;
  return [{ side: "front", corner, startMs: 0, endMs: durationMs }];
};

const stretchesFor = (take: Take): Stretch[] => {
  const durationMs = take.durationMs ?? 0;
  const pans = marksOf(take, durationMs).map((pan) => ({ ...pan, endMs: Math.min(pan.endMs ?? durationMs, durationMs) }));
  const parts = cornerPart(take) === null ? loopParts(take, pans[0]?.startMs ?? durationMs) : [];
  return [
    ...parts.map((part, i) => ({ kind: "loop" as const, ...part, last: pans.length === 0 && i === parts.length - 1 })),
    ...pans
      .filter((pan) => pan.endMs > pan.startMs)
      .map((pan) => ({ kind: "pan" as const, side: pan.corner ? cornerLabel(pan.corner) : pan.side, startSeconds: pan.startMs / 1000, endSeconds: pan.endMs / 1000, last: true })),
  ];
};

const savedIds =(saved: Take["tags"]): string[] => (saved === null || saved === undefined ? [] : "ids" in saved ? saved.ids : [saved.id]);

const sendTags = async (deps: SenderDeps, takes: TakeStore, take: Take, walkId: string): Promise<void> => {
  const saved = (await takes.get(take.id)).tags;
  if (saved?.sent === true) return;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const stretches = stretchesFor(take);
  if (stretches.length === 0) return;
  const ids = stretches.map((_, i) => savedIds(saved)[i] ?? newId());
  const tags = walkTags(take, walkId, stretches, ids);
  const answer = await deps.walks.tags(walkId, tags);
  const refusal = answer.code ?? null;
  await takes.saveTags(take.id, { ids, sent: refusal === null || refusal === "walk_not_uploading", refusal });
};

export const startWalk = async (
  deps: Pick<SenderDeps, "walks" | "visitorId">,
  takes: TakeStore,
  takeId: string,
): Promise<{ walkId: string; code?: undefined } | { walkId?: undefined; code: Failure }> => {
  const take = await takes.get(takeId);
  if (take.upload !== null) return { walkId: take.upload.walkId };
  const request = walkRequest(take, deps.visitorId());
  let started = await deps.walks.start(request);
  while (started.code === undefined && started.value.state.name === "failed") {
    started = await deps.walks.start({ ...request, startKey: started.value.walkId });
  }
  if (started.code !== undefined) return { code: started.code };
  const { walkId } = started.value;
  await takes.saveUpload(takeId, walkOnly(walkId));
  return { walkId };
};

export const walkSender =
  (deps: SenderDeps): Sender =>
  async (take, onProgress) => {
    const takes = await deps.takes();
    const started = await startWalk(deps, takes, take.id);
    if (started.code !== undefined) return { code: started.code };
    const { walkId } = started;
    await sendTags(deps, takes, take, walkId);
    return sendTake({ api: deps.uploads, put: deps.put, takes, onProgress, ...(deps.abort === undefined ? {} : { abort: deps.abort }) }, take, walkId);
  };
