import type { Device, StartWalkRequest, Tag } from "@emberwalk/shared";
import type { Fetch, UploadApi, WalkApi } from "./api.ts";
import type { Jurisdiction } from "./location.ts";
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

export const UNCONFIRMED_RULES: Jurisdiction = "ca";

const UNKNOWN_DEVICE: Device = { camera: UNKNOWN_CAMERA, ...IDEAL_SIZE };

export const walkRequest = (take: Take, visitorId: string): StartWalkRequest => ({
  language: "en",
  jurisdiction: take.jurisdiction ?? UNCONFIRMED_RULES,
  device: take.device ?? UNKNOWN_DEVICE,
  synthetic: false,
  visitorId,
});

const walkTag = (take: Take, walkId: string, id: string): Tag | null => {
  if (take.durationMs === null || take.durationMs <= 0) return null;
  return {
    id,
    walkId,
    kind: "loop",
    startSeconds: 0,
    endSeconds: take.durationMs / 1000,
    label: "Walk",
    samples: take.marks.motion,
    propertyLine: null,
  };
};

const sendTags = async (deps: SenderDeps, takes: TakeStore, take: Take, walkId: string): Promise<void> => {
  const saved = (await takes.get(take.id)).tags;
  if (saved?.sent === true) return;
  const id = saved?.id ?? (deps.newId ?? (() => crypto.randomUUID()))();
  const tag = walkTag(take, walkId, id);
  if (tag === null) return;
  const answer = await deps.walks.tags(walkId, [tag]);
  const refusal = answer.code ?? null;
  await takes.saveTags(take.id, { id, sent: refusal === null || refusal === "walk_not_uploading", refusal });
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
