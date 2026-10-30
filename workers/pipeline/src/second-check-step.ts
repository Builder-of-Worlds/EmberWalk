import { findingsForWalk, getWalk } from "@emberwalk/db";
import { confirmModel, secondCheck, withRetries } from "@emberwalk/meta";
import { RULES } from "@emberwalk/rules";
import { Id, SecondCheck, secondCheckKey } from "@emberwalk/shared";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { jpegDataUrl } from "./preview-step.ts";

export const SECOND_CHECK_BUDGET_MS = 4 * 60_000;

export const SecondCheckRecord = z.record(Id, SecondCheck);
export type SecondCheckRecord = z.infer<typeof SecondCheckRecord>;

export type Checked = { checked: number; failed: number; skipped: "real_walk" | "not_set_up" | "model_not_listed" | null };

const rulesOf = (ruleIds: string[]): { citation: string; words: string }[] =>
  RULES.filter((r) => ruleIds.includes(r.id)).map((r) => ({ citation: r.citation, words: r.requirement }));

const warn = (walkId: string, what: string, error: unknown): void =>
  console.warn(`walk ${walkId} ${what}: ${error instanceof Error ? error.message : String(error)}`);

export const secondCheckWalk = async (deps: Deps, walkId: string, budgetMs = SECOND_CHECK_BUDGET_MS, now: () => number = Date.now): Promise<Checked> => {
  const result: Checked = { checked: 0, failed: 0, skipped: null };
  const deadline = now() + budgetMs;
  try {
    const walk = await getWalk(deps.db, walkId);
    if (walk === null) throw new Error("the walk is missing");
    const findings = (await findingsForWalk(deps.db, walkId)).filter((f) => f.veto === null);
    if (findings.length === 0) return result;
    const realWalks = deps.secondCheckRealWalks ?? false;
    if (!walk.synthetic && !realWalks) return { ...result, skipped: "real_walk" };
    const baseten = deps.baseten?.() ?? null;
    if (baseten === null) return { ...result, skipped: "not_set_up" };
    try {
      await withRetries(() => confirmModel(baseten.transport), { sleep: deps.sleep });
    } catch (error) {
      warn(walkId, "skipped the second check", error);
      return { ...result, skipped: "model_not_listed" };
    }

    const record: SecondCheckRecord = {};
    const options = { content: walk.synthetic ? ("synthetic" as const) : ("real" as const), walkId, realWalks, sleep: deps.sleep };
    for (const f of findings) {
      if (now() >= deadline) {
        console.warn(`walk ${walkId} ran out of time for the second check after ${result.checked + result.failed} of ${findings.length}`);
        break;
      }
      try {
        const photo = await jpegDataUrl(deps.bucket, f.proofFrame.still);
        if (photo === null) throw new Error(`the proof still of finding ${f.id} is missing`);
        const finding = { concept: f.concept, band: f.band, distanceFeet: f.distanceFeet, label: f.label, instruction: f.instruction, rules: rulesOf(f.ruleIds), photo };
        record[f.id] = await secondCheck(baseten.client, finding, options);
        result.checked++;
      } catch (error) {
        warn(walkId, `has no second check for finding ${f.id}`, error);
        result.failed++;
      }
    }
    if (result.checked > 0) await deps.bucket.put(secondCheckKey(walkId), JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
  } catch (error) {
    warn(walkId, "could not be second checked", error);
    result.failed++;
  }
  return result;
};
