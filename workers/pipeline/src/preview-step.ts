import { findingsForWalk, getWalk } from "@emberwalk/db";
import { fixPrompt, type MetaClient, museImageEditCall } from "@emberwalk/meta";
import { previewKey } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";

export const PREVIEW_LIMIT = 3;
export const PREVIEW_BUDGET_MS = 4 * 60_000;

export type Previewed = { made: number; failed: number };

const CHUNK = 0x8000;

export const jpegDataUrl = async (bucket: R2Bucket, key: string): Promise<string | null> => {
  const stored = await bucket.get(key);
  if (stored === null) return null;
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const chunks = Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, i) => String.fromCharCode(...bytes.subarray(i * CHUNK, (i + 1) * CHUNK)));
  return `data:image/jpeg;base64,${btoa(chunks.join(""))}`;
};

const fromBase64 = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

const warn = (walkId: string, what: string, error: unknown): void =>
  console.warn(`walk ${walkId} ${what}: ${error instanceof Error ? error.message : String(error)}`);

export const previewWalk = async (deps: Deps, walkId: string, budgetMs = PREVIEW_BUDGET_MS, now: () => number = Date.now): Promise<Previewed> => {
  const result: Previewed = { made: 0, failed: 0 };
  const deadline = now() + budgetMs;
  try {
    const walk = await getWalk(deps.db, walkId);
    if (walk === null) throw new Error("the walk is missing");
    const top = (await findingsForWalk(deps.db, walkId)).filter((f) => f.veto === null).slice(0, PREVIEW_LIMIT);
    let client: MetaClient | null = null;
    for (const f of top) {
      if (now() >= deadline) {
        console.warn(`walk ${walkId} ran out of time for previews after ${result.made + result.failed} of ${top.length}`);
        break;
      }
      try {
        const image = await jpegDataUrl(deps.bucket, f.proofFrame.still);
        if (image === null) throw new Error(`the proof still of finding ${f.id} is missing`);
        client ??= deps.museImage();
        const call = museImageEditCall({ prompt: fixPrompt(f.concept, f.instruction), image, content: walk.synthetic ? "synthetic" : "real", walkId });
        const answer = await client.call(call);
        await deps.bucket.put(previewKey(walkId, f.id), fromBase64(answer.value.base64), { httpMetadata: { contentType: "image/jpeg" } });
        result.made++;
      } catch (error) {
        warn(walkId, `has no preview for finding ${f.id}`, error);
        result.failed++;
      }
    }
  } catch (error) {
    warn(walkId, "could not be previewed", error);
    result.failed++;
  }
  return result;
};
