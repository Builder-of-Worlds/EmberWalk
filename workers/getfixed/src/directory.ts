import type { CrewDirectory } from "@emberwalk/agent";
import { type CrewCard, listedSignups } from "@emberwalk/db";
import { CLASS_NAMES, checkLicenseUrl, milesBetween, nearestCrews, type NearCrew, type Trade as LicenseClass, UnknownZip } from "@emberwalk/directory";
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

const SIGNUP_MILES = 150;

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
    const centre = await o.db.prepare("SELECT lat, lng FROM zip_centres WHERE zip = ?").bind(zip).first<{ lat: number; lng: number }>();
    const signups = centre === null ? [] : await listedSignups(o.db, TRADE_CLASSES[trade]);
    const nearby = signups.map((s) => ({ s, miles: milesBetween(centre?.lat ?? 0, centre?.lng ?? 0, s.lat, s.lng) })).filter((r) => r.miles <= SIGNUP_MILES);
    const listed = new Set<string>();
    for (const { s, miles } of nearby.sort((a, b) => a.miles - b.miles)) {
      if (crews.length === n) break;
      const parsed = Crew.safeParse({ id: o.newId(), name: s.businessName, trade, zip: s.zip, email: s.email, phone: s.phone, licenseNumber: s.licenseNumber, sample: false });
      if (!parsed.success) continue;
      cards.set(parsed.data.id, {
        className: `${CLASS_NAMES[s.licenseClass as LicenseClass]} (${s.licenseClass})`,
        licenseStatus: s.licenseStatus,
        listedOn: s.listedOn,
        checkLicenseUrl: checkLicenseUrl(s.licenseNumber),
        distanceMiles: Math.round(miles * 10) / 10,
        approximate: s.approximate,
      });
      listed.add(s.licenseNumber);
      crews.push(parsed.data);
    }
    for (const c of found) {
      if (crews.length === n) break;
      if (listed.has(c.licenseNumber)) continue;
      const parsed = Crew.safeParse({ id: o.newId(), name: c.businessName.slice(0, 120), trade, zip: c.zip, email: null, phone: c.phoneE164, licenseNumber: c.licenseNumber, sample: false });
      if (!parsed.success) continue;
      cards.set(parsed.data.id, cardOf(c));
      crews.push(parsed.data);
    }
    return crews;
  };
  return { near, cards };
};
