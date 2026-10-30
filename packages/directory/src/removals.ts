import { z } from "zod";
import { checked, IsoDate } from "./types.ts";

const Removal = z.object({ licenseNumber: z.string().regex(/^\d{1,12}$/), requestedOn: IsoDate }).strict();

export const removeCrew = async (db: D1Database, request: z.input<typeof Removal>): Promise<void> => {
  const { licenseNumber, requestedOn } = checked(Removal, request, "removal");
  await db.prepare("INSERT OR IGNORE INTO crew_removals (license_number, requested_on) VALUES (?, ?)").bind(licenseNumber, requestedOn).run();
};
