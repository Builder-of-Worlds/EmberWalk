import { WorkerEntrypoint } from "cloudflare:workers";
import { sweepAccounts, sweepRecords } from "../../api/src/record-sweep.ts";
import { depsFrom } from "./deps.ts";
import type { Env } from "./env.ts";
import { type RecheckOutcome, recheckOutcome } from "./recheck-step.ts";
import { type StartResult, startWalk } from "./start.ts";
import { sweepVideos } from "./sweep.ts";

export { MediaContainer } from "./media-container.ts";
export { WalkPipeline } from "./workflow.ts";

export class PipelineEntry extends WorkerEntrypoint<Env> {
  start(walkId: string): Promise<StartResult> {
    return startWalk(this.env, walkId);
  }

  recheck(findingId: string, recheckId: string): Promise<RecheckOutcome> {
    return recheckOutcome(depsFrom(this.env), findingId, recheckId);
  }
}

export default {
  async fetch(request): Promise<Response> {
    if (new URL(request.url).pathname === "/health") return Response.json({ status: "ok" });
    return Response.json({ error: { code: "not_found", message: "No such endpoint." } }, { status: 404 });
  },
  async scheduled(controller, env): Promise<void> {
    const at = new Date(controller.scheduledTime);
    const outcomes = await Promise.allSettled([sweepVideos(env, at), sweepRecords(env, at).then(() => sweepAccounts(env, at))]);
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
  },
} satisfies ExportedHandler<Env>;
