import { expect } from "vitest";
import type { z } from "zod";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const FP = "ab".repeat(32);
export const AT = "2026-10-26T17:00:00Z";
export const LATER = "2026-10-26T18:00:00Z";

export const TAPPED_FINDING = {
  id: id(10),
  walkId: id(1),
  concept: "wood_pile",
  trackIds: [],
  band: "zone_0",
  distanceFeet: { low: 0, high: 1 },
  contact: "yes",
  severity: 10,
  rank: 1,
  proofFrame: { clipId: id(3), frame: 4, still: "stills/w1/4.jpg" },
  ruleIds: [],
  label: "required_now",
  instruction: "Move the wood pile away from the wall.",
  plantState: null,
  spacing: null,
  voiceNote: null,
  veto: null,
  source: "tapped",
  status: "needs_fixing",
};

export function roundTrips(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(JSON.parse(JSON.stringify(value)));
  expect(result.error?.issues).toBeUndefined();
  expect(result.data).toEqual(value);
}

export function refuses(schema: z.ZodType, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}

export function refusesEach(schema: z.ZodType, base: Record<string, unknown>, changes: Record<string, unknown>[]) {
  for (const change of changes) refuses(schema, { ...base, ...change });
}

export function refusesMissingAndExtra(schema: z.ZodType, value: Record<string, unknown>) {
  for (const key of Object.keys(value)) {
    const copy = { ...value };
    delete copy[key];
    refuses(schema, copy);
  }
  refuses(schema, { ...value, extra: 1 });
  refuses(schema, null);
  refuses(schema, "text");
}
