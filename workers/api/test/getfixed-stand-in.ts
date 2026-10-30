export const FAILING_ID = "00000000-0000-4000-8000-00000000f999";
export const OFF_ID = "00000000-0000-4000-8000-00000000f998";
export const UNAVAILABLE_ID = "00000000-0000-4000-8000-00000000f997";
export const MISSING_ID = "00000000-0000-4000-8000-00000000f996";

export const getFixedStandIn = {
  name: "emberwalk-getfixed",
  modules: true,
  compatibilityDate: "2026-08-15",
  script: `import { WorkerEntrypoint } from "cloudflare:workers";
const FAILING = "${FAILING_ID}";
const echo = (method, args) => args[0] === "${MISSING_ID}" ? { code: "not_found", message: "stand-in has none" } : args[0] === "${OFF_ID}" ? { code: "off", message: "stand-in is off" } : args[0] === "${UNAVAILABLE_ID}" ? { code: "unavailable", message: "stand-in is unavailable" } : (args[0] === FAILING ? { code: method === "inspection" ? "not_ready" : method === "approve" ? "send_failed" : method === "draft" ? "rate_limited" : "refused", message: "stand-in refused: Dry brush (Needs Fixing)" } : { value: { method, args } });
export class GetFixed extends WorkerEntrypoint {
  start(...a) { return echo("start", a); }
  jobs(...a) { return echo("jobs", a); }
  draft(...a) { return echo("draft", a); }
  addEmail(...a) { return echo("addEmail", a); }
  approve(...a) { return echo("approve", a); }
  sentByPhone(...a) { return echo("sentByPhone", a); }
  logReply(...a) { return echo("logReply", a); }
  followUps(...a) { return echo("followUps", a); }
  inspection(...a) { return echo("inspection", a); }
  optOut(token) { return token === "good.token" ? { value: { removed: true } } : token === "down.token" ? { code: "unavailable", message: "no" } : { code: "not_found", message: "no" }; }
}
export default { fetch() { return new Response("stand-in"); } };`,
};
