import { DbRefused, getJob, getWalk, jobCrews, logStep } from "@emberwalk/db";
import type { Crew } from "@emberwalk/shared";
import { type AgentDeps, AgentOff, keepCrews } from "./loop.ts";

export type PickDeps = Pick<AgentDeps, "enabled" | "db" | "directory" | "now">;

export async function pickCrews(deps: PickDeps, jobId: string): Promise<Crew[]> {
  if (deps.enabled !== true) throw new AgentOff();
  const job = await getJob(deps.db, jobId);
  if (job === null) throw new DbRefused(`job ${jobId} does not exist`);
  const held = await jobCrews(deps.db, job.id);
  if (held.length > 0) return held;
  const walk = await getWalk(deps.db, job.walkId);
  if (walk === null) throw new DbRefused(`walk ${job.walkId} does not exist`);
  const kept = await keepCrews(deps, job, walk.synthetic);
  await logStep(deps.db, { jobId: job.id, at: deps.now().toISOString(), tool: "pick_crews", arguments: "", outcome: "ran", detail: kept.detail });
  return kept.crews;
}
