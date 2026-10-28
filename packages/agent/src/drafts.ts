import { findingsForWalk, getJob } from "@emberwalk/db";
import type { Concept, Finding, OutgoingMessage } from "@emberwalk/shared";

export const MAX_BODY = 5000;
export const WORK_HEADING = "What needs doing:";

export type PhotoStore = { has(key: string): Promise<boolean> };

export type DraftPhoto = { findingId: string; key: string };

export class DraftRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "DraftRefused";
  }
}

export const CONCEPT_NAMES: { [C in Concept]: string } = {
  dry_brush: "Dry brush",
  dry_grass: "Dry grass",
  shed: "Shed",
  propane_tank: "Propane tank",
  tree: "Tree",
  shrub: "Shrub",
  tree_branch_over_roof: "Branches over the roof",
  wood_pile: "Wood pile",
  roof_debris: "Leaves and needles on the roof",
  wooden_fence: "Wooden fence",
  foundation_vent: "Foundation vent",
  trash_can: "Trash can",
  patio_furniture: "Patio furniture",
  chimney: "Chimney",
  house_wall: "House wall",
};

const byRank = (findings: Finding[]): Finding[] => [...findings].sort((a, b) => a.rank - b.rank);

export function workList(findings: Finding[]): string {
  if (findings.length === 0) throw new DraftRefused("a work list needs at least one finding");
  const lines = byRank(findings).map((f, i) => `${i + 1}. ${CONCEPT_NAMES[f.concept]} (Photo ${i + 1}): ${f.instruction}`);
  return [WORK_HEADING, ...lines].join("\n");
}

export const bodyRoom = (findings: Finding[]): number => MAX_BODY - workList(findings).length - 2;

export function lengthRefusal(body: string, findings: Finding[]): string | null {
  const room = bodyRoom(findings);
  return body.length > room ? `the body is ${body.length} characters; with the work list EmberWalk adds, it may have at most ${room}` : null;
}

export function withWork(body: string, findings: Finding[]): string {
  const refused = lengthRefusal(body, findings);
  if (refused !== null) throw new DraftRefused(refused);
  return `${body}\n\n${workList(findings)}`;
}

export async function missingStills(photos: PhotoStore, findings: Finding[]): Promise<Finding[]> {
  const held = await Promise.all(findings.map((f) => photos.has(f.proofFrame.still)));
  return findings.filter((_, i) => !held[i]);
}

export const missingReason = (missing: Finding[]): string => `no blurred photo of finding ${missing.map((f) => `${f.id} (${f.concept})`).join(", ")}`;

export async function draftPhotos(db: D1Database, photos: PhotoStore, message: Pick<OutgoingMessage, "jobId">): Promise<DraftPhoto[]> {
  const job = await getJob(db, message.jobId);
  if (job === null) throw new DraftRefused(`job ${message.jobId} does not exist`);
  const findings = byRank((await findingsForWalk(db, job.walkId)).filter((f) => job.findingIds.includes(f.id)));
  const missing = await missingStills(photos, findings);
  if (missing.length > 0) throw new DraftRefused(missingReason(missing));
  return findings.map((f) => ({ findingId: f.id, key: f.proofFrame.still }));
}
