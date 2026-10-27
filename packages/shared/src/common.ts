import { z } from "zod";

export const Id = z.uuid();
export const Timestamp = z.iso.datetime();
export const Fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
export const Language = z.enum(["en", "es"]);
export const FileKey = z
  .string()
  .regex(/^(originals|clips|stills|previews|rechecks|reports|cache)\/[A-Za-z0-9._/-]{1,400}$/)
  .refine((key) => !key.split("/").includes(".."), "must not climb out of its folder");
export const Unit = z.number().min(0).max(1);
export const Point = z.strictObject({ x: Unit, y: Unit });
export const Text = (max: number) => z.string().trim().min(1).max(max);

export type Id = z.infer<typeof Id>;
export type Timestamp = z.infer<typeof Timestamp>;
export type Fingerprint = z.infer<typeof Fingerprint>;
export type Language = z.infer<typeof Language>;
export type FileKey = z.infer<typeof FileKey>;
export type Point = z.infer<typeof Point>;
