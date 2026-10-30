import type { CrewDirectory } from "@emberwalk/agent";
import type { CrewCard } from "@emberwalk/db";
import { nearestCrews, type NearCrew, type Trade as LicenseClass, UnknownZip } from "@emberwalk/directory";
import { Crew, type Trade } from "@emberwalk/shared";

export const TRADE_CLASSES: { [T in Trade]: LicenseClass[] } = {
  tree_service: ["C-49", "D-49"],
  brush_clearing: ["C-27"],
  debris_hauling: ["C-27", "B"],
  roofing_gutters: ["C-39"],
  fencing: ["C-13"],
  handyman: ["B"],
};

export const SEARCH_LIMIT = 20;

export type CardedDirectory = CrewDirectory & { cards: Map<string, CrewCard> };

const cardOf = (c: NearCrew): CrewCard => ({
  className: `${c.className} (${c.trade})`,
  licenseStatus: c.licenseStatus,
  listedOn: c.listedOn,
  checkLicenseUrl: c.checkLicenseUrl,
  distanceMiles: c.distanceMiles,
  approximate: c.approximate,
});

export const directoryFor = (o: { db: D1Database; newId: () => string }): CardedDirectory => {
  const cards = new Map<string, CrewCard>();
  const near = async (trade: Trade, zip: string, n: number) => {
    let found: NearCrew[];
    try {
      found = (await nearestCrews(o.db, { trade: TRADE_CLASSES[trade], zip, limit: SEARCH_LIMIT })).crews;
    } catch (error) {
      if (error instanceof UnknownZip) return [];
      throw error;
    }
    const crews = [];
    for (const c of found) {
      if (crews.length === n) break;
      const parsed = Crew.safeParse({ id: o.newId(), name: c.businessName.slice(0, 120), trade, zip: c.zip, email: null, phone: c.phoneE164, licenseNumber: c.licenseNumber, sample: false });
      if (!parsed.success) continue;
      cards.set(parsed.data.id, cardOf(c));
      crews.push(parsed.data);
    }
    return crews;
  };
  return { near, cards };
};
