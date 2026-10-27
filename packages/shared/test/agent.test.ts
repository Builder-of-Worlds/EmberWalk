import { describe, it } from "vitest";
import { AgentJob, Crew, FollowUp, OutgoingMessage } from "../src/index.ts";
import { AT, LATER, id, refuses, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const crew = {
  id: id(30),
  name: "Sample Tree Crew",
  trade: "tree_service",
  zip: "95401",
  email: "crew@example.com",
  phone: null,
  licenseNumber: "1234567",
  sample: true,
};

const draft = {
  id: id(32),
  jobId: id(31),
  crewId: id(30),
  channel: "email",
  status: "draft",
  subject: "Brush clearing request",
  body: "Could you clear the dry brush on the back side?",
  createdAt: AT,
  approvedAt: null,
  sentAt: null,
};

describe("Get It Fixed records", () => {
  it("round trips a crew and refuses a bad one", () => {
    roundTrips(Crew, crew);
    roundTrips(Crew, { ...crew, email: null, phone: "+17075550100", licenseNumber: null });
    refusesMissingAndExtra(Crew, crew);
    refusesEach(Crew, crew, [
      { email: null, phone: null },
      { zip: "9540" },
      { phone: "707-555-0100" },
      { email: "not an email" },
      { trade: "plumbing" },
      { licenseNumber: "A123" },
    ]);
  });

  it("round trips a job and refuses a bad one", () => {
    const job = { id: id(31), walkId: id(1), trade: "brush_clearing", findingIds: [id(10)], status: "waiting_on_crew", createdAt: AT, updatedAt: LATER };
    roundTrips(AgentJob, job);
    refusesMissingAndExtra(AgentJob, job);
    refusesEach(AgentJob, job, [{ findingIds: [] }, { status: "lost" }]);
  });

  it("round trips a message through each of its states", () => {
    roundTrips(OutgoingMessage, draft);
    roundTrips(OutgoingMessage, { ...draft, status: "approved", approvedAt: AT });
    roundTrips(OutgoingMessage, { ...draft, status: "sent", approvedAt: AT, sentAt: LATER });
    roundTrips(OutgoingMessage, { ...draft, channel: "text", subject: null, status: "sent_by_phone", approvedAt: AT, sentAt: LATER });
    roundTrips(OutgoingMessage, { ...draft, status: "replied", approvedAt: AT, sentAt: LATER });
    refusesMissingAndExtra(OutgoingMessage, draft);
  });

  it("refuses a message whose times do not match its state", () => {
    refusesEach(OutgoingMessage, draft, [
      { approvedAt: AT },
      { status: "approved" },
      { status: "approved", approvedAt: AT, sentAt: LATER },
      { status: "sent", approvedAt: AT },
      { status: "replied", approvedAt: null, sentAt: LATER },
      { sentAt: LATER },
      { channel: "text" },
      { status: "lost" },
      { body: "" },
    ]);
  });

  it("round trips a follow up and refuses a bad one", () => {
    const followUp = { id: id(33), jobId: id(31), dueAt: LATER, note: "Ask again about the date", draftMessageId: null, done: false };
    roundTrips(FollowUp, followUp);
    roundTrips(FollowUp, { ...followUp, draftMessageId: id(32), done: true });
    refusesMissingAndExtra(FollowUp, followUp);
    refuses(FollowUp, { ...followUp, dueAt: "tomorrow" });
  });
});
