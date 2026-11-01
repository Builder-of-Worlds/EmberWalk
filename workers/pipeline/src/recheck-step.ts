import { findingsForWalk, getWalk, ownerOfFinding } from "@emberwalk/db";
import { type Call, type ContentKind, sparkJsonCall, toBase64 } from "@emberwalk/meta";
import { Id, Recheck, recheckAnswerKey, recheckPhotoKey } from "@emberwalk/shared";
import { z } from "zod";
import type { Deps } from "./deps.ts";

const INPUT_TOKEN_ESTIMATE = 4_000;
const MAX_OUTPUT_TOKENS = 300;

export const RECHECK_PHRASE = "Photo one is from the walk, photo two is the new photo.";

export const RecheckAnswer = z.strictObject({ result: Recheck.shape.result });
export type RecheckAnswer = z.infer<typeof RecheckAnswer>;

export const recheckInstructions = (concept: string, instruction: string): string =>
  [
    "You check whether a fire safety fix around a house was done.",
    `Photo one, from the homeowner's walk, shows this problem: ${concept.replaceAll("_", " ")}. What was asked: ${instruction}`,
    "Photo two is a new photo of the same spot.",
    'Answer "cleared" only when photo two clearly shows the same spot and the problem is gone.',
    'Answer "still_there" when photo two shows the problem is still there.',
    'Answer "unsure" when photo two is not clear, shows a different spot, or you cannot tell.',
    'Reply with JSON only, no other text: {"result": "cleared" or "still_there" or "unsure"}.',
  ].join("\n");

export type RecheckCallRequest = {
  concept: string;
  instruction: string;
  before: { bytes: Uint8Array; type: string };
  after: { bytes: Uint8Array; type: string };
  content: ContentKind;
  walkId: string;
};

const picture = (image: { bytes: Uint8Array; type: string }) => ({ type: "input_image", image_url: `data:${image.type};base64,${toBase64(image.bytes)}` });

export const recheckCall = (r: RecheckCallRequest): Call<RecheckAnswer> => {
  if (r.before.bytes.length === 0 || r.after.bytes.length === 0) throw new TypeError("both photos must hold image bytes");
  return sparkJsonCall(
    {
      instructions: recheckInstructions(r.concept, r.instruction),
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: RECHECK_PHRASE }, picture(r.before), picture(r.after)] }],
      content: r.content,
      inputTokenEstimate: INPUT_TOKEN_ESTIMATE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      step: "recheck",
      walkId: r.walkId,
      extra: { reasoning: { effort: "low" } },
    },
    RecheckAnswer,
  );
};

export type RecheckRefusal = "unknown_finding" | "not_done" | "no_photo";

export class RecheckRefused extends Error {
  readonly code: RecheckRefusal;
  constructor(code: RecheckRefusal) {
    super(code);
    this.name = "RecheckRefused";
    this.code = code;
  }
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic"];

const imageOf = async (bucket: R2Bucket, key: string): Promise<{ bytes: Uint8Array; type: string } | null> => {
  const stored = await bucket.get(key);
  if (stored === null) return null;
  const type = stored.httpMetadata?.contentType ?? "image/jpeg";
  return { bytes: new Uint8Array(await stored.arrayBuffer()), type: IMAGE_TYPES.includes(type) ? type : "image/jpeg" };
};

export const recheckFinding = async (deps: Deps, findingId: string, recheckId: string, now: () => number = Date.now): Promise<Recheck> => {
  if (!Id.safeParse(findingId).success || !Id.safeParse(recheckId).success) throw new RecheckRefused("unknown_finding");
  const owner = await ownerOfFinding(deps.db, findingId);
  const finding = owner === null ? undefined : (await findingsForWalk(deps.db, owner.walkId)).find((f) => f.id === findingId);
  if (owner === null || finding === undefined || finding.veto !== null) throw new RecheckRefused("unknown_finding");
  if (finding.status !== "done") throw new RecheckRefused("not_done");

  const answerKey = recheckAnswerKey(owner.walkId, findingId, recheckId);
  const answered = await deps.bucket.get(answerKey);
  if (answered !== null) return Recheck.parse(await answered.json());

  const photo = recheckPhotoKey(owner.walkId, findingId, recheckId);
  const after = await imageOf(deps.bucket, photo);
  if (after === null) throw new RecheckRefused("no_photo");
  const before = await imageOf(deps.bucket, finding.proofFrame.still);
  if (before === null) throw new Error(`the proof still of finding ${findingId} is missing`);
  const walk = await getWalk(deps.db, owner.walkId);
  if (walk === null) throw new Error(`the walk of finding ${findingId} is missing`);

  const content: ContentKind = walk.synthetic ? "synthetic" : "real";
  const answer = await deps.meta().call(recheckCall({ concept: finding.concept, instruction: finding.instruction, before, after, content, walkId: owner.walkId }));
  const recheck = Recheck.parse({ id: recheckId, findingId, photo, result: answer.value.result, createdAt: new Date(now()).toISOString() });
  const stored = await deps.bucket.put(answerKey, JSON.stringify(recheck), {
    httpMetadata: { contentType: "application/json" },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (stored !== null) return recheck;
  const first = await deps.bucket.get(answerKey);
  if (first === null) throw new Error(`the answer of recheck ${recheckId} was refused and is missing`);
  return Recheck.parse(await first.json());
};

export type RecheckOutcome = { recheck: Recheck } | { refused: RecheckRefusal } | { failed: string };

export const recheckOutcome = async (deps: Deps, findingId: string, recheckId: string): Promise<RecheckOutcome> => {
  try {
    return { recheck: await recheckFinding(deps, findingId, recheckId) };
  } catch (error) {
    if (error instanceof RecheckRefused) return { refused: error.code };
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`recheck ${recheckId} of finding ${findingId} failed: ${message}`);
    return { failed: message.slice(0, 300) };
  }
};
