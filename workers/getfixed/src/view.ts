import { tradesOf } from "@emberwalk/agent";
import { cardsForJob, type CrewCard as Card, findingsForWalk, followUpsForJob, jobCrews, jobsForWalk, messagesForJob, outboxState, repliesForJob } from "@emberwalk/db";
import type { Crew, FixedCrew, FixedJob, FixedJobsResponse, FixedMessage } from "@emberwalk/shared";

export type CrewView = FixedCrew;

export type MessageView = FixedMessage;

export type JobView = FixedJob;

export type JobsView = FixedJobsResponse;

const NO_CARD: Card = { className: null, licenseStatus: null, listedOn: null, checkLicenseUrl: null, distanceMiles: null, approximate: false };

const crewView = (crew: Crew, card: Card | undefined): CrewView => ({
  ...(card ?? NO_CARD),
  id: crew.id,
  name: crew.name,
  licenseNumber: crew.licenseNumber,
  phone: crew.phone,
  email: crew.email,
  sample: crew.sample,
});

export const stillUrl = (walkId: string, findingId: string): string => `/api/walks/${walkId}/stills/${findingId}`;

export async function jobsView(db: D1Database, walkId: string): Promise<JobsView> {
  const findings = await findingsForWalk(db, walkId);
  const open = findings.filter((f) => f.status === "needs_fixing" && f.veto === null);
  const rank = new Map(findings.map((f) => [f.id, f.rank]));
  const jobs: JobView[] = [];
  for (const job of await jobsForWalk(db, walkId)) {
    const cards = await cardsForJob(db, job.id);
    const replies = await repliesForJob(db, job.id);
    const photos = [...job.findingIds].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)).map((id) => ({ findingId: id, url: stillUrl(walkId, id) }));
    const messages: MessageView[] = [];
    for (const m of await messagesForJob(db, job.id)) {
      const outbox = await outboxState(db, m.id);
      messages.push({
        id: m.id,
        crewId: m.crewId,
        channel: m.channel,
        status: m.status,
        subject: m.subject,
        body: m.body,
        createdAt: m.createdAt,
        approvedAt: m.approvedAt,
        sentAt: m.sentAt,
        outbox: outbox === null ? null : { state: outbox.state as "sending" | "sent" | "failed", error: outbox.error },
        photos,
        replies: replies.filter((r) => r.messageId === m.id).map(({ id, via, receivedAt, text, reading }) => ({ id, via, receivedAt, text, reading })),
      });
    }
    jobs.push({
      id: job.id,
      trade: job.trade,
      status: job.status,
      findingIds: job.findingIds,
      crews: (await jobCrews(db, job.id)).map((c) => crewView(c, cards.get(c.id))),
      messages,
      followUps: (await followUpsForJob(db, job.id)).map(({ id, forMessageId, dueAt, note, draftMessageId, done }) => ({ id, forMessageId, dueAt, note, draftMessageId, done })),
    });
  }
  return { walkId, jobs, yourself: open.filter((f) => tradesOf(f).length === 0).map((f) => f.id) };
}
