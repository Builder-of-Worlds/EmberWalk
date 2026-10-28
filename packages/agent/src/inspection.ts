import { findingsForWalk, getWalk } from "@emberwalk/db";
import type { Finding, FindingStatus } from "@emberwalk/shared";
import { CONCEPT_NAMES } from "./drafts.ts";
import { AgentOff } from "./loop.ts";

export type InspectionLink = { label: string; url: string; readOn: string };

export type InspectionRequest = { walkId: string; subject: string; body: string; links: InspectionLink[]; findingIds: string[] };

export type InspectionDeps = { enabled: boolean; db: D1Database };

export const SYNTHETIC_LABEL = "Synthetic sample house";

export const CALFIRE_LINKS: InspectionLink[] = [
  { label: "CAL FIRE Defensible Space", url: "https://www.fire.ca.gov/dspace", readOn: "2026-10-27" },
  { label: "CAL FIRE Request An Inspection form", url: "https://survey123.arcgis.com/share/a15c7706b4114e20b39d2a26294338ed", readOn: "2026-10-27" },
  {
    label: "CAL FIRE: Find your Fire Hazard Severity Zone and local public contacts",
    url: "https://calfire-forestry.maps.arcgis.com/apps/instant/lookup/index.html?appid=4663e7486e364f05a933daeae7931125",
    readOn: "2026-10-27",
  },
];

const STATUS_WORDS: { [S in FindingStatus]: string } = { needs_fixing: "Needs Fixing", fix_planned: "Fix Planned", done: "Done" };

export class InspectionRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "InspectionRefused";
  }
}

const fixedList = (findings: Finding[]): string => findings.map((f, i) => `${i + 1}. ${CONCEPT_NAMES[f.concept]}: ${f.instruction}`).join("\n");

const linkList = (): string => CALFIRE_LINKS.map((l) => `- ${l.label}: ${l.url}`).join("\n");

export async function inspectionRequest(deps: InspectionDeps, walkId: string): Promise<InspectionRequest> {
  if (!deps.enabled) throw new AgentOff();
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) throw new InspectionRefused(`walk ${walkId} does not exist`);
  const required = (await findingsForWalk(deps.db, walkId)).filter((f) => f.label === "required_now" && f.veto === null).sort((a, b) => a.rank - b.rank);
  if (required.length === 0) throw new InspectionRefused(`walk ${walkId} has no Required Now item`);
  const open = required.filter((f) => f.status !== "done");
  if (open.length > 0) {
    throw new InspectionRefused(`not every Required Now item is Done: ${open.map((f) => `${CONCEPT_NAMES[f.concept]} (${STATUS_WORDS[f.status]})`).join(", ")}`);
  }
  const subject = walk.synthetic ? `Defensible space inspection request (${SYNTHETIC_LABEL})` : "Defensible space inspection request";
  const body = [
    ...(walk.synthetic ? [`${SYNTHETIC_LABEL}.`, ""] : []),
    "Hello,",
    "",
    "I have finished the Required Now defensible space work at my house and would like to ask for a defensible space inspection.",
    "",
    "What I fixed:",
    fixedList(required),
    "",
    "Could you tell me how to book an inspection with my local fire department or fire protection district?",
    "",
    "CAL FIRE pages:",
    linkList(),
    "",
    "Thank you.",
  ].join("\n");
  return { walkId, subject, body, links: CALFIRE_LINKS, findingIds: required.map((f) => f.id) };
}
