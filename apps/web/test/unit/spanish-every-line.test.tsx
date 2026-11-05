import { describe, expect, it } from "vitest";
import { copyEn, draftEn, unbackedEn } from "../../src/copy.ts";
import { copyEs, draftEs, unbackedEs } from "../../src/copy-es.ts";
import {
  billingEn,
  crewEn,
  deleteEverythingEn,
  demoEn,
  findingEn,
  inspectionEn,
  inviteEn,
  movedEn,
  portfolioEn,
  recheckEn,
  reportEn,
  signInEn,
} from "../../src/draft-words.ts";
import {
  billingEs,
  crewEs,
  deleteEverythingEs,
  demoEs,
  findingEs,
  inspectionEs,
  inviteEs,
  movedEs,
  portfolioEs,
  recheckEs,
  reportEs,
  signInEs,
} from "../../src/draft-words-es.ts";

const SAME_IN_BOTH = new Set(["EmberWalk", "Stripe", "Individual", "hello@emberwalk.app", "CAL FIRE", "C-27", "C-49", "English", "Español"]);

const SAMPLE_ARGS: unknown[][] = [[], ["front"], ["front_right"], [1], [2], [1, 2], [2, 5], ["2026-11-01"], ["Cedar Lane"], ["$49.00"], [3, "$9.00"], ["wood_pile", 1, 2]];

const lines = (value: unknown, path: string, out: Map<string, string>, depth = 0): void => {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    out.set(path, value);
  } else if (typeof value === "function") {
    for (const args of SAMPLE_ARGS) {
      try {
        const made = (value as (...a: unknown[]) => unknown)(...args);
        lines(made, `${path}(${JSON.stringify(args)})`, out, depth + 1);
      } catch {
        continue;
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => lines(item, `${path}[${i}]`, out, depth + 1));
  } else if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) lines(item, `${path}.${key}`, out, depth + 1);
  }
};

const SETS: [string, unknown, unknown][] = [
  ["copy", copyEn, copyEs],
  ["draft", draftEn, draftEs],
  ["unbacked", unbackedEn, unbackedEs],
  ["billing", billingEn, billingEs],
  ["crew", crewEn, crewEs],
  ["deleteEverything", deleteEverythingEn, deleteEverythingEs],
  ["demo", demoEn, demoEs],
  ["finding", findingEn, findingEs],
  ["inspection", inspectionEn, inspectionEs],
  ["invite", inviteEn, inviteEs],
  ["moved", movedEn, movedEs],
  ["portfolio", portfolioEn, portfolioEs],
  ["recheck", recheckEn, recheckEs],
  ["report", reportEn, reportEs],
  ["signIn", signInEn, signInEs],
];

describe("every line has its own Spanish, in every state", () => {
  it.each(SETS)("%s has no Spanish line that is the English line", (_name, en, es) => {
    const english = new Map<string, string>();
    const spanish = new Map<string, string>();
    lines(en, "", english);
    lines(es, "", spanish);
    const same: string[] = [];
    for (const [path, text] of english) {
      if (spanish.get(path) === text && /[A-Za-z]{3}/.test(text) && !SAME_IN_BOTH.has(text) && !/@/.test(text)) same.push(`${path}: ${text}`);
    }
    expect(same).toEqual([]);
  });

  it("covers a real number of lines", () => {
    const english = new Map<string, string>();
    for (const [, en] of SETS) lines(en, "", english);
    expect(english.size).toBeGreaterThan(800);
  });
});
