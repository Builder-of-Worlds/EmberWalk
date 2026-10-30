import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ErrorCode,
  FIXED_CODES,
  FIXED_ROUTE_CODES,
  FixedApprovalResponse,
  FixedEmailRequest,
  FixedHistoryResponse,
  FixedInspectionResponse,
  FixedJobsResponse,
  FixedMarkRequest,
  FixedMarkResponse,
  FixedReplyRequest,
  FixedSentByPhoneResponse,
  FixedZipRequest,
  stillPath,
} from "../src/index.ts";
import { AT, id, refuses, refusesEach, roundTrips } from "./check.ts";

const WALK = id(1);
const FINDING = id(2);

const crew = {
  id: id(20),
  name: "Valley Tree Care",
  className: "Tree and Palm Contractor (C-49)",
  licenseNumber: "123456",
  licenseStatus: "CLEAR",
  listedOn: "2026-10-28",
  checkLicenseUrl: "https://license.example/123456",
  distanceMiles: 2.3,
  approximate: false,
  phone: "+12095550101",
  email: "office@valley.example",
  sample: false,
};

const reply = {
  id: id(40),
  via: "email",
  receivedAt: AT,
  text: "We can come Saturday.",
  reading: { price: "$400", date: "Saturday", questions: ["Is the gate open?"], declined: false, summary: "They can come Saturday for $400." },
};

const message = {
  id: id(30),
  crewId: crew.id,
  channel: "email",
  status: "replied",
  subject: "Tree work near my house",
  body: "Hello, could you look at the oak over my roof?",
  createdAt: AT,
  approvedAt: AT,
  sentAt: AT,
  outbox: { state: "sent", error: null },
  photos: [{ findingId: FINDING, url: stillPath(WALK, FINDING) }],
  replies: [reply],
};

const job = {
  id: id(10),
  trade: "tree_service",
  status: "waiting_on_crew",
  findingIds: [FINDING],
  crews: [crew],
  messages: [message],
  followUps: [{ id: id(50), forMessageId: message.id, dueAt: AT, note: "Nudge the crew.", draftMessageId: null, done: false }],
};

const jobs = { walkId: WALK, jobs: [job], yourself: [id(3)] };

const mark = { id: id(60), findingId: FINDING, status: "done", note: null, doneOn: "2026-10-28", markedAt: AT };

describe("the Get It Fixed request bodies", () => {
  it("take a ZIP, an email, a reply and a mark as the routes read them", () => {
    roundTrips(FixedZipRequest, { zip: "95370" });
    roundTrips(FixedEmailRequest, { email: "office@valley.example" });
    expect(FixedReplyRequest.parse({ text: "  They called.  " })).toEqual({ text: "They called." });
    roundTrips(FixedMarkRequest, { status: "fix_planned", note: "Saturday." });
    roundTrips(FixedMarkRequest, { status: "done", doneOn: "2026-10-28" });
    roundTrips(FixedMarkRequest, { status: "needs_fixing" });
  });

  it("refuse a short ZIP, a bad email, a blank reply, a bad status or day, and any extra key", () => {
    refuses(FixedZipRequest, { zip: "9537" });
    refuses(FixedZipRequest, { zip: "95370", extra: 1 });
    refuses(FixedEmailRequest, { email: "office" });
    refuses(FixedEmailRequest, { email: `${"a".repeat(250)}@x.example` });
    refuses(FixedReplyRequest, { text: "   " });
    refuses(FixedReplyRequest, { text: "x".repeat(10_001) });
    refusesEach(FixedMarkRequest, { status: "done" }, [{ status: "fixed" }, { doneOn: "Oct 28" }, { note: "n".repeat(201) }, { extra: 1 }]);
  });
});

describe("the Get It Fixed answers", () => {
  it("accept a real jobs view, an approval, a sent by phone, an inspection request, a history and a saved mark", () => {
    roundTrips(FixedJobsResponse, jobs);
    roundTrips(FixedApprovalResponse, { status: "sent" });
    roundTrips(FixedApprovalResponse, { status: "approved", phone: "+12095550101", body: "Hi" });
    roundTrips(FixedSentByPhoneResponse, { status: "sent_by_phone" });
    roundTrips(FixedInspectionResponse, { subject: "Inspection request", body: "Please inspect.", links: [{ label: "Fire rules", url: "https://rules.example/a" }] });
    roundTrips(FixedHistoryResponse, { walks: [{ walkId: WALK, walkedOn: "2026-10-27", synthetic: false, state: "done", marks: [{ ...mark, concept: "wood_pile" }] }] });
    roundTrips(FixedMarkResponse, { mark });
  });

  it("refuse a jobs view with a trade, status, id, phone, channel or photo path off the contract, or a key too many", () => {
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, trade: "plumbing" }] });
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, status: "lost" }] });
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, id: "j1" }] });
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, crews: [{ ...crew, phone: "2095550101" }] }] });
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, crews: [{ ...crew, distanceMiles: -1 }] }] });
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, messages: [{ ...message, channel: "fax" }] }] });
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, messages: [{ ...message, photos: [{ findingId: FINDING, url: "https://elsewhere.example/a.jpg" }] }] }] });
    refuses(FixedJobsResponse, { ...jobs, jobs: [{ ...job, messages: [{ ...message, jobId: job.id }] }] });
    refuses(FixedJobsResponse, { walkId: WALK, jobs: [] });
  });

  it("refuse an approval, an inspection request, a history and a mark that are off the contract", () => {
    refuses(FixedApprovalResponse, { status: "approved" });
    refuses(FixedApprovalResponse, { status: "sent", phone: "+12095550101" });
    refuses(FixedApprovalResponse, { status: "weird" });
    refuses(FixedSentByPhoneResponse, { status: "sent" });
    refuses(FixedInspectionResponse, { subject: "S", body: "B", links: [{ label: "L", url: "javascript:alert(1)" }] });
    refuses(FixedHistoryResponse, { walks: [{ walkId: WALK, walkedOn: "Oct 27", synthetic: false, state: "done", marks: [] }] });
    refuses(FixedHistoryResponse, { walks: [{ walkId: WALK, walkedOn: "2026-10-27", synthetic: false, state: "done", marks: [{ ...mark, concept: "moat" }] }] });
    refuses(FixedMarkResponse, {});
    refuses(FixedMarkResponse, { mark: { ...mark, status: "fixed" } });
  });
});

describe("the Get It Fixed error codes", () => {
  it("are all error codes the API can send, and the service codes are the ones the route turns into them", () => {
    for (const code of ["send_failed", "not_ready", "conflict", "rate_limited"]) expect(ERROR_CODES).toContain(code);
    for (const code of FIXED_ROUTE_CODES) expect(ErrorCode.safeParse(code).success).toBe(true);
    expect(FIXED_CODES).toEqual(["not_found", "refused", "off", "unavailable", "send_failed", "not_ready", "rate_limited"]);
  });
});
