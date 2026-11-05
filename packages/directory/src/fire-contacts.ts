export type FireContact = { id: string; agency: string; email: string; source: string; readOn: string; zips: readonly string[] };

// A ZIP is listed only when the Census 2020 ZCTA relationship files place all its land in the agency's county and none in an incorporated city.
export const ZIP_SOURCE = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/";

export const FIRE_CONTACTS: readonly FireContact[] = [
  {
    id: "nevada-county-oes",
    agency: "County of Nevada Office of Emergency Services",
    email: "DefensibleSpace@nevadacountyca.gov",
    source: "https://nevadacountyca.gov/2750/California-Local-Fire-Safety-Law",
    readOn: "2026-10-31",
    zips: ["95946", "95975", "95986", "96111"],
  },
  {
    id: "permit-sonoma-fire-prevention",
    agency: "Permit Sonoma Fire Prevention Division",
    email: "FirePrevention@sonomacounty.gov",
    source: "https://permitsonoma.org/divisions/firepreventionandhazmat/wildfireriskreductionandpreparation/vegetationmanagementservices/hazardousvegetation/inspectionsfaqs",
    readOn: "2026-10-31",
    zips: [
      "94922", "94923", "94951", "94972", "95412", "95419", "95421", "95430", "95431", "95439", "95441",
      "95442", "95444", "95446", "95450", "95452", "95462", "95465", "95471", "95480", "95486", "95497",
    ],
  },
];

export const fireContactFor = (zip: string): FireContact | null => FIRE_CONTACTS.find((row) => row.zips.includes(zip)) ?? null;
