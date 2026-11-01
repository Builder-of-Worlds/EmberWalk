import { z } from "zod";

const MiB = 1024 * 1024;
const count = z.int().positive();

export const Limits = z
  .strictObject({
    dailySpendUsd: z.number().positive(),
    deleteEverythingOn: z.boolean(),
    liveWalksPerVisitorPerDay: count,
    maxFps: z.number().positive(),
    defaultFps: z.number().positive(),
    maxWalkSeconds: count,
    maxVideoBitsPerSecond: count,
    uploadPartBytes: count,
    uploadMinPartBytes: count,
    uploadLinkTtlSeconds: count,
    uploadSessionTtlSeconds: count,
    uploadMaxTriesPerPart: count,
    maxObjectsPerFrame: count,
    faultCountMost: count,
    faultKeepDays: count,
    faultRowsADay: count,
    recheckOn: z.boolean(),
    recheckPhotoBytes: count,
    rechecksPerFinding: count,
    paymentsOn: z.boolean(),
  })
  .refine((l) => l.defaultFps <= l.maxFps, { message: "defaultFps must not pass maxFps", path: ["defaultFps"] })
  .refine((l) => l.uploadMinPartBytes <= l.uploadPartBytes, {
    message: "uploadPartBytes must be at least uploadMinPartBytes",
    path: ["uploadPartBytes"],
  })
  .refine((l) => l.uploadLinkTtlSeconds <= l.uploadSessionTtlSeconds, {
    message: "a part link must not outlive its upload",
    path: ["uploadLinkTtlSeconds"],
  });

export type Limits = z.infer<typeof Limits>;

export const DEFAULT_LIMITS: Limits = Limits.parse({
  dailySpendUsd: 20,
  deleteEverythingOn: false,
  liveWalksPerVisitorPerDay: 3,
  maxFps: 4,
  defaultFps: 2,
  maxWalkSeconds: 6 * 60,
  maxVideoBitsPerSecond: 24_000_000,
  uploadPartBytes: 10 * MiB,
  uploadMinPartBytes: 5 * MiB,
  uploadLinkTtlSeconds: 15 * 60,
  uploadSessionTtlSeconds: 2 * 60 * 60,
  uploadMaxTriesPerPart: 3,
  maxObjectsPerFrame: 16,
  faultCountMost: 1000,
  faultKeepDays: 30,
  faultRowsADay: 500,
  recheckOn: false,
  recheckPhotoBytes: 20 * MiB,
  rechecksPerFinding: 5,
  paymentsOn: false,
});

export const maxWalkBytes = (l: Limits): number => Math.ceil((l.maxWalkSeconds * l.maxVideoBitsPerSecond) / 8);

export const uploadMaxParts = (l: Limits): number => Math.ceil(maxWalkBytes(l) / l.uploadPartBytes);

export const limitsWith = (overrides: Partial<Limits>): Limits => Limits.parse({ ...DEFAULT_LIMITS, ...overrides });

export const limitsFromConfig = (raw: string | undefined): Limits => {
  if (raw === undefined || raw === "") return DEFAULT_LIMITS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_LIMITS;
    return limitsWith(parsed as Partial<Limits>);
  } catch {
    return DEFAULT_LIMITS;
  }
};
