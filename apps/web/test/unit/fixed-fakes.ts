import { stillPath } from "@emberwalk/shared";
import type { Fetch } from "../../src/api.ts";
import type { CrewCard, History, InspectionRequest, Job, JobsView, Message } from "../../src/fixed-api.ts";
import { LIVE_WALK, liveFindingId } from "./result-fakes.ts";

export const WALK = LIVE_WALK;

export const uid = (kind: number, n: number): string => `00000000-0000-4000-8000-${kind.toString(16).padStart(2, "0")}${n.toString(16).padStart(10, "0")}`;

const KINDS: Record<string, number> = { j: 0xa1, c: 0xc0, m: 0xd0, r: 0xe0, k: 0xb0, f: 0xf0 };
const TOKENS = new Map<string, string>();
const ref = (token: string): string => {
  const id = uid(KINDS[token[0]!]!, Number(token.slice(1)));
  TOKENS.set(id, token);
  return id;
};
const tokenOf = (id: string): string => TOKENS.get(id) ?? id;

export const J1 = ref("j1");
export const C1 = ref("c1");
export const C2 = ref("c2");
export const C3 = ref("c3");
export const C9 = ref("c9");
export const M1 = ref("m1");
export const M2 = ref("m2");
export const M3 = ref("m3");
export const M4 = ref("m4");
export const M5 = ref("m5");
export const M6 = ref("m6");
export const M7 = ref("m7");
export const M9 = ref("m9");
export const R1 = ref("r1");
export const R2 = ref("r2");
export const F1 = ref("f1");
export const F2 = ref("f2");
export const F3 = ref("f3");
export const K1 = ref("k1");
export const K2 = ref("k2");
export const K3 = ref("k3");
export const K4 = ref("k4");

export const draftId = (jobId: string, n: number): string => uid(0xd1, Number.parseInt(jobId.slice(-10), 16) * 100 + n);

export const crew = (id: string, over: Partial<CrewCard> = {}): CrewCard => ({
  id,
  name: `Crew ${tokenOf(id)}`,
  className: "Tree and Palm Contractor (C-49)",
  licenseNumber: "123456",
  licenseStatus: "CLEAR",
  listedOn: "2026-10-28",
  checkLicenseUrl: `https://license.example/${id}`,
  distanceMiles: 2.3,
  approximate: false,
  phone: "+12095550101",
  email: `${tokenOf(id)}@crews.example`,
  sample: false,
  ...over,
});

export const photo = (n: number) => ({ findingId: liveFindingId(n), url: stillPath(WALK, liveFindingId(n)) });

export const message = (id: string, crewId: string, over: Partial<Message> = {}): Message => ({
  id,
  crewId,
  channel: "email",
  status: "draft",
  subject: "Tree work near my house",
  body: "Hello, could you look at the oak over my roof?",
  createdAt: "2026-10-28T19:00:00.000Z",
  approvedAt: null,
  sentAt: null,
  outbox: null,
  photos: [photo(1)],
  replies: [],
  ...over,
});

export const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  trade: "tree_service",
  status: "planning",
  findingIds: [liveFindingId(1)],
  crews: [crew(C1), crew(C2, { email: null, phone: null, checkLicenseUrl: null, distanceMiles: 4, approximate: true })],
  messages: [],
  followUps: [],
  ...over,
});

export const jobsView = (jobs: Job[], yourself: string[] = []): JobsView => ({ walkId: WALK, jobs, yourself });

export type StandIn = {
  view: JobsView;
  planned: JobsView;
  history: History;
  ready: boolean;
  openItems: string;
  inspectionError: { status: number; code: string; message: string } | null;
  inspection: InspectionRequest;
  sendFails: boolean;
  limited: boolean;
  offline: boolean;
  walks: string[];
  findings: string[];
  markRefused: boolean;
  calls: { method: string; path: string; body: unknown }[];
};

export const standIn = (over: Partial<StandIn> = {}): StandIn => ({
  view: jobsView([]),
  planned: jobsView([job(J1)]),
  history: { walks: [] },
  ready: true,
  openItems: "InspectionRefused: not every Required Now item is Done: Move the wood pile (Needs Fixing)",
  inspectionError: null,
  inspection: { subject: "Inspection request", body: "Please inspect my defensible space.", links: [{ label: "Fire rules", url: "https://rules.example/a" }] },
  sendFails: false,
  limited: false,
  offline: false,
  walks: [WALK],
  findings: [liveFindingId(1), liveFindingId(2)],
  markRefused: false,
  calls: [],
  ...over,
});

type Reply = { status: number; json: unknown };

const refusal = (status: number, code: string, message = "No."): Reply => ({ status, json: { error: { code, message } } });

const withMessage = (state: StandIn, messageId: string): { found: Message; jobOf: Job } | null => {
  for (const jobOf of state.view.jobs) {
    const found = jobOf.messages.find((m) => m.id === messageId);
    if (found) return { found, jobOf };
  }
  return null;
};

const UNSENT: Message["status"][] = ["draft", "approved"];

const waitOnCrewsWhenAllSent = (target: Job): void => {
  if (!target.messages.some((m) => UNSENT.includes(m.status))) target.status = "waiting_on_crew";
};

export const respond = (state: StandIn, method: string, path: string, body: unknown): Reply => {
  state.calls.push({ method, path, body });
  const ok = (json: unknown, status = 200): Reply => ({ status, json });
  const parts = path.split("/").filter((p) => p !== "");
  const send = body as Record<string, string>;
  if (parts[1] === "walks" && !state.walks.includes(parts[2] ?? "")) return refusal(404, "not_found");
  if (method === "POST" && parts[3] === "get-it-fixed") {
    state.view = state.planned;
    return ok(state.view);
  }
  if (method === "GET" && parts[3] === "jobs") return ok(state.view);
  if (method === "POST" && parts[1] === "jobs" && parts[3] === "drafts") {
    const target = state.view.jobs.find((j) => j.id === parts[2]);
    if (!target) return refusal(404, "not_found");
    if (state.limited) return refusal(429, "rate_limited");
    target.messages = target.crews.map((c, i) =>
      message(draftId(target.id, i + 1), c.id, c.email === null ? { channel: "text", subject: null } : {}),
    );
    if (target.status === "planning" && target.messages.length > 0) target.status = "waiting_on_homeowner";
    return ok(state.view);
  }
  if (method === "PUT" && parts[1] === "jobs" && parts[3] === "crews") {
    const target = state.view.jobs.find((j) => j.id === parts[2]);
    if (!target) return refusal(404, "not_found");
    if (target.messages.some((m) => m.crewId === parts[4])) return refusal(409, "conflict", "A request exists.");
    const chosen = target.crews.find((c) => c.id === parts[4]);
    if (chosen) chosen.email = send.email ?? null;
    return ok(state.view);
  }
  if (method === "POST" && parts[1] === "messages" && parts[3] === "approve") {
    const hit = withMessage(state, parts[2]!);
    if (!hit) return refusal(404, "not_found");
    if (state.sendFails) {
      hit.found.status = "approved";
      return refusal(502, "send_failed", "The mail service failed.");
    }
    if (hit.found.channel === "email") {
      hit.found.status = "sent";
      hit.found.sentAt = "2026-10-29T19:00:00.000Z";
      waitOnCrewsWhenAllSent(hit.jobOf);
      return ok({ status: "sent" });
    }
    hit.found.status = "approved";
    const phone = hit.jobOf.crews.find((c) => c.id === hit.found.crewId)?.phone ?? "";
    return ok({ status: "approved", phone, body: hit.found.body });
  }
  if (method === "POST" && parts[1] === "messages" && parts[3] === "sent-by-phone") {
    const hit = withMessage(state, parts[2]!);
    if (!hit) return refusal(404, "not_found");
    hit.found.status = "sent_by_phone";
    hit.found.sentAt = "2026-10-29T19:00:00.000Z";
    waitOnCrewsWhenAllSent(hit.jobOf);
    return ok({ status: "sent_by_phone" });
  }
  if (method === "POST" && parts[1] === "messages" && parts[3] === "replies") {
    const hit = withMessage(state, parts[2]!);
    if (!hit) return refusal(404, "not_found");
    hit.found.status = "replied";
    hit.found.replies.push({ id: uid(0xe1, hit.found.replies.length + 1), via: "homeowner", receivedAt: "2026-10-29T19:00:00.000Z", text: send.text ?? "", reading: null });
    return ok(state.view);
  }
  if (method === "POST" && parts[3] === "followups") return ok(state.view);
  if (method === "POST" && parts[3] === "inspection-request" && state.inspectionError !== null)
    return refusal(state.inspectionError.status, state.inspectionError.code, state.inspectionError.message);
  if (method === "POST" && parts[3] === "inspection-request")
    return state.ready ? ok(state.inspection) : refusal(409, "not_ready", state.openItems);
  if (method === "GET" && parts[1] === "history") return ok(state.history);
  if (method === "POST" && parts[1] === "findings" && parts[3] === "status") {
    if (!state.findings.includes(parts[2] ?? "")) return refusal(404, "not_found");
    if (state.markRefused) return refusal(409, "conflict");
    return ok({ mark: { id: uid(0xb1, 1), findingId: parts[2], note: null, doneOn: null, markedAt: "2026-10-29T19:00:00.000Z", ...send } }, 201);
  }
  return refusal(404, "not_found");
};

export const standInFetch =
  (state: StandIn): Fetch =>
  async (request) => {
    if (state.offline) throw new TypeError("offline");
    const text = await request.text();
    const reply = respond(state, request.method, new URL(request.url).pathname, text === "" ? null : JSON.parse(text));
    return Response.json(reply.json, { status: reply.status });
  };
