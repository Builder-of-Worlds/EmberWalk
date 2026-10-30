import { z } from "zod";
import { DirectoryRefused } from "./errors.ts";

export const Trade = z.enum(["C-27", "C-49", "D-49", "B", "C-13", "C-29", "C-39"]);
export type Trade = z.infer<typeof Trade>;

export const Zip = z.string().regex(/^\d{5}$/);

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s);
  });

export const Lat = z.number().min(-90).max(90);
export const Lng = z.number().min(-180).max(180);

export const Classes = z
  .array(Trade)
  .min(1)
  .refine((held) => held.every((t, i) => i === 0 || Trade.options.indexOf(held[i - 1]!) < Trade.options.indexOf(t)), "classes must be unique and in the fixed order");

export const Crew = z
  .object({
    licenseNumber: z.string().regex(/^\d{1,12}$/),
    trade: Trade,
    classes: Classes,
    businessName: z.string().min(1).max(200),
    address: z.string().max(300),
    zip: Zip,
    phone: z.string().max(40),
    licenseStatus: z.string().min(1).max(60),
    listedOn: IsoDate,
  })
  .strict()
  .refine((c) => c.classes.includes(c.trade), "a crew's classes must hold its own trade");
export type Crew = z.infer<typeof Crew>;

export const ZipCentre = z.object({ zip: Zip, lat: Lat, lng: Lng, loadedOn: IsoDate }).strict();
export type ZipCentre = z.infer<typeof ZipCentre>;

export const checked = <T>(schema: z.ZodType<T>, value: unknown, what: string): T => {
  const out = schema.safeParse(value);
  if (!out.success) throw new DirectoryRefused(`${what}: ${out.error.issues.map((i) => `${i.path.join(".") || "value"} ${i.message}`).join("; ")}`);
  return out.data;
};
