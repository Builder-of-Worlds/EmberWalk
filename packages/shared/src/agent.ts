import { z } from "zod";
import { Id, Text, Timestamp } from "./common.ts";

export const Trade = z.enum(["tree_service", "brush_clearing", "debris_hauling", "roofing_gutters", "fencing", "handyman"]);
export const Zip = z.string().regex(/^\d{5}$/);
export const Phone = z.string().regex(/^\+1\d{10}$/);

export const Crew = z
  .strictObject({
    id: Id,
    name: Text(120),
    trade: Trade,
    zip: Zip,
    email: z.email().nullable(),
    phone: Phone.nullable(),
    licenseNumber: z.string().regex(/^\d{1,8}$/).nullable(),
    sample: z.boolean(),
  })
  .refine((c) => c.email !== null || c.phone !== null, { message: "a crew needs an email or a phone", path: ["email"] });

export const AgentJob = z.strictObject({
  id: Id,
  walkId: Id,
  trade: Trade,
  findingIds: z.array(Id).min(1).max(50),
  status: z.enum(["planning", "waiting_on_homeowner", "waiting_on_crew", "scheduled", "done", "closed"]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const MessageStatus = z.enum(["draft", "approved", "sent", "sent_by_phone", "replied"]);

export const OutgoingMessage = z
  .strictObject({
    id: Id,
    jobId: Id,
    crewId: Id,
    channel: z.enum(["email", "text"]),
    status: MessageStatus,
    subject: Text(200).nullable(),
    body: Text(5000),
    createdAt: Timestamp,
    approvedAt: Timestamp.nullable(),
    sentAt: Timestamp.nullable(),
  })
  .refine((m) => (m.status === "draft") === (m.approvedAt === null), {
    message: "a message is approved exactly when it has left the draft state",
    path: ["approvedAt"],
  })
  .refine((m) => ["draft", "approved"].includes(m.status) === (m.sentAt === null), {
    message: "a message has a sent time exactly when it was sent",
    path: ["sentAt"],
  })
  .refine((m) => m.channel === "email" || m.subject === null, { message: "a text has no subject", path: ["subject"] });

export const FollowUp = z.strictObject({
  id: Id,
  jobId: Id,
  dueAt: Timestamp,
  note: Text(500),
  draftMessageId: Id.nullable(),
  done: z.boolean(),
});

export type Trade = z.infer<typeof Trade>;
export type Crew = z.infer<typeof Crew>;
export type AgentJob = z.infer<typeof AgentJob>;
export type MessageStatus = z.infer<typeof MessageStatus>;
export type OutgoingMessage = z.infer<typeof OutgoingMessage>;
export type FollowUp = z.infer<typeof FollowUp>;
