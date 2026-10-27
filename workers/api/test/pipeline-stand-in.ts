export const pipelineStandIn = {
  name: "emberwalk-pipeline",
  modules: true,
  compatibilityDate: "2026-08-15",
  script: `import { WorkerEntrypoint } from "cloudflare:workers";
export class PipelineEntry extends WorkerEntrypoint {
  async start() { return { started: false, reason: "test_stand_in" }; }
}
export default { fetch() { return new Response("stand-in"); } };`,
};
