import { z } from "zod";
import { FileKey, Fingerprint, Id, Text, Timestamp } from "./common.ts";
import { PipelineStep } from "./walk.ts";

const Usd = z.number().nonnegative();

export const CostRecord = z
  .strictObject({
    id: Id,
    at: Timestamp,
    model: Text(120),
    step: z.enum([...PipelineStep.options, "agent"]),
    walkId: Id.nullable(),
    units: z.strictObject({ kind: z.enum(["frames", "images", "tokens", "seconds"]), count: z.int().nonnegative() }),
    unitPriceUsd: Usd,
    totalUsd: Usd,
    cached: z.boolean(),
  })
  .refine((c) => !c.cached || c.totalUsd === 0, { message: "a cached answer costs nothing", path: ["totalUsd"] });

export const CacheEntry = z.strictObject({
  fingerprint: Fingerprint,
  model: Text(120),
  createdAt: Timestamp,
  answer: FileKey,
});

export type CostRecord = z.infer<typeof CostRecord>;
export type CacheEntry = z.infer<typeof CacheEntry>;
