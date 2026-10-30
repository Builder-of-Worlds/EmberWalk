import { CompletedPart, PartLinkResponse, StartUploadResponse, StartWalkResponse, Tag } from "@emberwalk/shared";
import { z } from "zod";
import { type Fetch, post } from "./api.ts";
import { ImportError } from "./errors.ts";
import { checkRender } from "./render.ts";
import type { RenderSource, VideoSource } from "./source.ts";

export const PART_TRIES = 3;
export const WALK_LABEL = "Synthetic walk";

const Completed = z.object({ walkId: z.string(), bytes: z.int() });

export type ImportOptions = {
  origin: string;
  fetch: Fetch;
  render: RenderSource;
  visitorId?: string;
};

export type Imported = { walkId: string; bytes: number; parts: number; tags: number };

const newVisitorId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

const sendPart = async (
  options: ImportOptions,
  uploadId: string,
  partNumber: number,
  video: VideoSource,
  range: [number, number],
): Promise<CompletedPart> => {
  const bytes = await video.read(...range);
  if (bytes.length !== range[1] - range[0]) throw new ImportError("video_unreadable", `Part ${partNumber} could not be read from the video.`);
  for (let attempt = 1; attempt <= PART_TRIES; attempt += 1) {
    const link = await post(options.fetch, options.origin, "/api/uploads/part", { uploadId, partNumber }, PartLinkResponse);
    const length = link.headers["content-length"];
    const headers: Record<string, string> = length === undefined ? {} : { "content-length": length };
    try {
      const response = await options.fetch(new Request(link.url, { method: link.method, headers, body: bytes }));
      const etag = response.headers.get("etag")?.replaceAll('"', "") ?? "";
      if (response.ok && etag !== "") return { partNumber, etag };
    } catch (error) {
      if (error instanceof ImportError) throw error;
    }
  }
  throw new ImportError("part_failed", `Part ${partNumber} was refused ${PART_TRIES} times.`);
};

const upload = async (options: ImportOptions, walkId: string, video: VideoSource): Promise<{ bytes: number; parts: number }> => {
  const { fetch: send, origin } = options;
  const started = await post(send, origin, "/api/uploads", { walkId, totalBytes: video.sizeBytes }, StartUploadResponse);
  const parts: CompletedPart[] = [];
  try {
    for (let partNumber = 1; partNumber <= started.partCount; partNumber += 1) {
      const from = (partNumber - 1) * started.partBytes;
      const to = Math.min(from + started.partBytes, video.sizeBytes);
      parts.push(await sendPart(options, started.uploadId, partNumber, video, [from, to]));
    }
    const done = await post(send, origin, "/api/uploads/complete", { uploadId: started.uploadId, parts }, Completed);
    return { bytes: done.bytes, parts: parts.length };
  } catch (error) {
    await post(send, origin, "/api/uploads/abort", { uploadId: started.uploadId }, z.object({})).catch(() => undefined);
    throw error;
  }
};

export const importWalk = async (options: ImportOptions): Promise<Imported> => {
  const checked = await checkRender(options.render);
  const { fetch: send, origin } = options;

  const walk = await post(
    send,
    origin,
    "/api/walks",
    {
      visitorId: options.visitorId ?? newVisitorId(),
      language: "en",
      jurisdiction: "ca",
      device: { camera: "synthetic render", width: checked.width, height: checked.height },
      synthetic: true,
    },
    StartWalkResponse,
  );
  const tag = Tag.parse({
    id: crypto.randomUUID(),
    walkId: walk.walkId,
    kind: "loop",
    startSeconds: 0,
    endSeconds: checked.durationSeconds,
    label: WALK_LABEL,
    samples: checked.samples,
    propertyLine: null,
  });
  await post(send, origin, `/api/walks/${walk.walkId}/tags`, { tags: [tag] }, z.object({ tags: z.literal(1) }));
  const sent = await upload(options, walk.walkId, checked.video);
  return { walkId: walk.walkId, bytes: sent.bytes, parts: sent.parts, tags: 1 };
};
