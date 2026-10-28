import type { Device, StartWalkRequest, Tag } from "@emberwalk/shared";
import type { Fetch, UploadApi, WalkApi } from "./api.ts";
import type { Jurisdiction } from "./location.ts";
import { partsOf } from "./parts.ts";
import type { Part } from "./parts.ts";
import { IDEAL_SIZE, UNKNOWN_CAMERA } from "./recorder.ts";
import type { Take, TakeStore } from "./take-store.ts";
import { sendTake } from "./uploader.ts";
import type { Progress, SendResult } from "./uploader.ts";

export type Sender = (take: Take, onProgress: (progress: Progress) => void) => Promise<SendResult>;

export type SenderDeps = {
  walks: WalkApi;
  uploads: UploadApi;
  put: Fetch;
  takes: () => Promise<TakeStore>;
  visitorId: () => string;
  newId?: () => string;
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
});

const walkTags = (take: Take, walkId: string, parts: readonly Part[], ids: readonly string[]): Tag[] =>
  parts.map((part, i) => ({
    id: ids[i] as string,
    walkId,
    kind: "loop",
    startSeconds: part.startSeconds,
    endSeconds: part.endSeconds,
    label: part.side ?? "Walk",
    samples: take.marks.motion.filter(({ t }) => t >= part.startSeconds && (t < part.endSeconds || (i === parts.length - 1 && t === part.endSeconds))),
    propertyLine: null,
  }));

const partsFor = (take: Take): Part[] => {
  const parts = partsOf(take.durationMs ?? 0, take.marks.motion);
  const side = take.partOf?.side;
  return side === undefined || parts.length === 0 ? parts : [{ side, startSeconds: 0, endSeconds: parts.at(-1)!.endSeconds }];
};

const savedIds =(saved: Take["tags"]): string[] => (saved === null || saved === undefined ? [] : "ids" in saved ? saved.ids : [saved.id]);

const sendTags = async (deps: SenderDeps, takes: TakeStore, take: Take, walkId: string): Promise<void> => {
  const saved = (await takes.get(take.id)).tags;
  if (saved?.sent === true) return;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const parts = partsFor(take);
  if (parts.length === 0) return;
  const ids = parts.map((_, i) => savedIds(saved)[i] ?? newId());
  const tags = walkTags(take, walkId, parts, ids);
  const answer = await deps.walks.tags(walkId, tags);
  const refusal = answer.code ?? null;
  await takes.saveTags(take.id, { ids, sent: refusal === null || refusal === "walk_not_uploading", refusal });
};

export const walkSender =
  (deps: SenderDeps): Sender =>
  async (take, onProgress) => {
    const takes = await deps.takes();
    let walkId = (await takes.get(take.id)).upload?.walkId;
    if (walkId === undefined) {
      const started = await deps.walks.start(walkRequest(take, deps.visitorId()));
      if (started.code !== undefined) return { code: started.code };
      walkId = started.value.walkId;
      await takes.saveUpload(take.id, { walkId, uploadId: null, partBytes: 0, partCount: 0, parts: [] });
    }
    await sendTags(deps, takes, take, walkId);
    return sendTake({ api: deps.uploads, put: deps.put, takes, onProgress }, take, walkId);
  };
