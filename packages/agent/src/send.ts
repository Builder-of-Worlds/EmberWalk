import { getMessage, jobCrews, markSent } from "@emberwalk/db";
import type { Crew, OutgoingMessage } from "@emberwalk/shared";

export type Outbox = { send(message: OutgoingMessage, crew: Crew): Promise<void> };

export type SendDeps = { db: D1Database; outbox: Outbox; now: () => Date };

export class SendRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SendRefused";
  }
}

export async function sendApproved(deps: SendDeps, messageId: string): Promise<void> {
  const message = await getMessage(deps.db, messageId);
  if (message === null) throw new SendRefused(`message ${messageId} does not exist`);
  if (message.status !== "approved") throw new SendRefused(`message ${messageId} is ${message.status}; only a message the homeowner approved is sent`);
  const crew = (await jobCrews(deps.db, message.jobId)).find((c) => c.id === message.crewId);
  if (crew === undefined) throw new SendRefused(`crew ${message.crewId} is not on job ${message.jobId}`);
  await deps.outbox.send(message, crew);
  await markSent(deps.db, message.id, deps.now().toISOString(), "sent");
}
