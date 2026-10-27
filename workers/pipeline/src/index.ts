import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env.ts";
import { type StartResult, startWalk } from "./start.ts";

export { WalkPipeline } from "./workflow.ts";

export class PipelineEntry extends WorkerEntrypoint<Env> {
  start(walkId: string): Promise<StartResult> {
    return startWalk(this.env, walkId);
  }
}

export default {
  async fetch(request): Promise<Response> {
    if (new URL(request.url).pathname === "/health") return Response.json({ status: "ok" });
    return Response.json({ error: { code: "not_found", message: "No such endpoint." } }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
