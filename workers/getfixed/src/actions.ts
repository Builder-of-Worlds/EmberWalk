import {
  type AgentDeps,
  AgentOff,
  DraftRefused,
  draftPhotos,
  type FollowUpOutcome,
  InspectionRefused,
  inspectionRequest,
  pickCrews,
  PlanRefused,
  planJobs,
  RateLimited,
  readReplies,
  runFollowUps,
  runJob,
  SendRefused,
  sendApproved,
} from "@emberwalk/agent";
import {
  approveMessage,
  CapReached,
  DbRefused,
  findingsForWalk,
  followUpsForJob,
  getJob,
  getMessage,
  getWalk,
  jobCrews,
  jobsForWalk,
  markSent,
  messagesForJob,
  optOutAddress,
  removeLicense,
  saveCrewCards,
  saveReply,
  setCrewEmail,
  setJobStatus,
} from "@emberwalk/db";
import { MetaHttpError, MetaRefused } from "@emberwalk/meta";
import type { FixedApprovalResponse, FixedCode, FixedInspectionResponse, FixedSentByPhoneResponse, OutgoingMessage } from "@emberwalk/shared";
import { z } from "zod";
import { type Deps, ModelOff } from "./deps.ts";
import { directoryFor } from "./directory.ts";
import { MailFailed, MailOff, mailConfig, messageOfToken, resendOutbox } from "./mail.ts";
import { jobsView, type JobsView } from "./view.ts";

export const MAX_APPROVED_EMAILS_PER_DAY = 25;

export type Answer<T> = { value: T } | { code: FixedCode; message: string };

export type Approved = FixedApprovalResponse;

export type Inspection = FixedInspectionResponse;

const failure = (error: unknown): { code: FixedCode; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof NotFound) return { code: "not_found", message };
  if (error instanceof AgentOff || error instanceof MailOff || error instanceof ModelOff) return { code: "off", message };
  if (error instanceof MetaRefused || error instanceof MetaHttpError) return { code: "unavailable", message };
  if (error instanceof MailFailed) return { code: "send_failed", message };
  if (error instanceof Refused) return { code: "refused", message };
  if (error instanceof InspectionRefused) return { code: "not_ready", message };
  if (error instanceof RateLimited || error instanceof CapReached) return { code: "rate_limited", message };
  if (error instanceof z.ZodError) return { code: "refused", message: z.prettifyError(error) };
  if (error instanceof DbRefused || error instanceof SendRefused || error instanceof DraftRefused || error instanceof PlanRefused) return { code: "refused", message };
  throw error;
};

const answer = async <T>(work: () => Promise<T>): Promise<Answer<T>> => {
  try {
    return { value: await work() };
  } catch (error) {
    return failure(error);
  }
};

class NotFound extends Error {
  constructor(what: string) {
    super(`${what} does not exist`);
    this.name = "NotFound";
  }
}

class Refused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "Refused";
  }
}

const notFound = (what: string): NotFound => new NotFound(what);

const photoStore = (media: R2Bucket) => ({ has: async (key: string) => (await media.head(key)) !== null });

const agentDeps = (d: Deps): AgentDeps & { cards: ReturnType<typeof directoryFor>["cards"] } => {
  const directory = directoryFor({ db: d.db, newId: d.newId });
  return {
    enabled: d.enabled,
    get client() {
      return d.meta();
    },
    db: d.db,
    directory,
    photos: photoStore(d.media),
    now: d.now,
    newId: d.newId,
    cards: directory.cards,
  };
};

const walkOf = async (d: Deps, walkId: string) => {
  const walk = await getWalk(d.db, walkId);
  if (walk === null || walk.synthetic) throw notFound(`walk ${walkId}`);
  return walk;
};

const jobOf = async (d: Deps, jobId: string) => {
  const job = await getJob(d.db, jobId);
  if (job === null) throw notFound(`job ${jobId}`);
  return job;
};

const messageOf = async (d: Deps, messageId: string): Promise<OutgoingMessage> => {
  const message = await getMessage(d.db, messageId);
  if (message === null) throw notFound(`message ${messageId}`);
  return message;
};

const waitOnCrewsWhenAllSent = async (d: Deps, jobId: string): Promise<void> => {
  const unsent = (await messagesForJob(d.db, jobId)).some((m) => m.status === "draft" || m.status === "approved");
  if (!unsent) await setJobStatus(d.db, jobId, "waiting_on_crew", d.now().toISOString());
};

export const timerId = (messageId: string): string => `follow-up-${messageId}`;

const startTimer = async (d: Deps, message: OutgoingMessage): Promise<void> => {
  const reminder = (await followUpsForJob(d.db, message.jobId)).some((f) => f.draftMessageId === message.id);
  if (reminder) return;
  try {
    await d.env.FOLLOW_UP_TIMER.create({ id: timerId(message.id), params: { messageId: message.id } });
  } catch (error) {
    console.warn(`follow up timer for message ${message.id} did not start: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const stillsOf = (d: Deps) => async (message: OutgoingMessage): Promise<Uint8Array[]> => {
  const photos = await draftPhotos(d.db, photoStore(d.media), message);
  const stills: Uint8Array[] = [];
  for (const p of photos) {
    const object = await d.media.get(p.key);
    if (object === null) throw new DraftRefused(`the photo for finding ${p.findingId} is gone`);
    stills.push(new Uint8Array(await object.arrayBuffer()));
  }
  return stills;
};

export const tryReading = async (d: Deps, jobId: string): Promise<void> => {
  try {
    await walkOf(d, (await jobOf(d, jobId)).walkId);
    await readReplies(agentDeps(d), jobId);
  } catch (error) {
    console.warn(`replies on job ${jobId} were not read: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const start = (d: Deps, walkId: string, zip: string): Promise<Answer<JobsView>> =>
  answer(async () => {
    const walk = await walkOf(d, walkId);
    if (walk.state.name !== "done") throw new Refused(`walk ${walk.id} is not done`);
    const deps = agentDeps(d);
    const plan = await planJobs(deps, walk.id, zip);
    for (const job of plan.jobs) {
      const kept = new Set((await pickCrews(deps, job.id)).map((c) => c.id));
      await saveCrewCards(d.db, job.id, new Map([...deps.cards].filter(([id]) => kept.has(id))));
    }
    return jobsView(d.db, walk.id);
  });

export const view = (d: Deps, walkId: string): Promise<Answer<JobsView>> => answer(async () => jobsView(d.db, (await walkOf(d, walkId)).id));

export const draft = (d: Deps, jobId: string): Promise<Answer<JobsView>> =>
  answer(async () => {
    const job = await jobOf(d, jobId);
    const walk = await walkOf(d, job.walkId);
    await runJob(agentDeps(d), job.id);
    return jobsView(d.db, walk.id);
  });

export const addEmail = (d: Deps, jobId: string, crewId: string, email: string): Promise<Answer<JobsView>> =>
  answer(async () => {
    const job = await jobOf(d, jobId);
    await setCrewEmail(d.db, job.id, crewId, email);
    return jobsView(d.db, job.walkId);
  });

export const approve = (d: Deps, messageId: string, visitorId: string): Promise<Answer<Approved>> =>
  answer(async () => {
    const message = await messageOf(d, messageId);
    const config = message.channel === "email" ? mailConfig(d.env) : null;
    if (message.status === "draft") {
      const photoKeys = (await draftPhotos(d.db, photoStore(d.media), message)).map((p) => p.key);
      await approveMessage(d.db, message.id, d.now().toISOString(), { visitorId, photoKeys }, MAX_APPROVED_EMAILS_PER_DAY);
    } else if (message.status !== "approved") throw new SendRefused(`message ${message.id} is already ${message.status}`);
    if (config === null) {
      const crew = (await jobCrews(d.db, message.jobId)).find((c) => c.id === message.crewId);
      if (crew?.phone == null) throw new SendRefused(`crew ${message.crewId} has no phone number`);
      return { status: "approved", phone: crew.phone, body: message.body };
    }
    const outbox = resendOutbox({ db: d.db, config, fetch: d.fetch, stills: stillsOf(d), newToken: d.newToken, now: d.now });
    await sendApproved({ db: d.db, outbox, now: d.now }, message.id);
    await startTimer(d, await messageOf(d, message.id));
    await waitOnCrewsWhenAllSent(d, message.jobId);
    return { status: "sent" };
  });

export const sentByPhone = (d: Deps, messageId: string): Promise<Answer<FixedSentByPhoneResponse>> =>
  answer(async () => {
    const message = await messageOf(d, messageId);
    if (message.channel !== "text" || message.status !== "approved") throw new SendRefused(`message ${message.id} is not an approved text`);
    await markSent(d.db, message.id, d.now().toISOString(), "sent_by_phone");
    await startTimer(d, await messageOf(d, message.id));
    await waitOnCrewsWhenAllSent(d, message.jobId);
    return { status: "sent_by_phone" };
  });

export const logReply = (d: Deps, messageId: string, text: string): Promise<Answer<JobsView>> =>
  answer(async () => {
    const message = await messageOf(d, messageId);
    await saveReply(d.db, { id: d.newId(), messageId: message.id, via: "homeowner", fromAddress: null, subject: null, text, receivedAt: d.now().toISOString() });
    await tryReading(d, message.jobId);
    return jobsView(d.db, (await jobOf(d, message.jobId)).walkId);
  });

export const readJobReplies = (d: Deps, jobId: string): Promise<Answer<{ read: number }>> =>
  answer(async () => {
    const job = await jobOf(d, jobId);
    return readReplies(agentDeps(d), job.id);
  });

export const followUpsFor = (d: Deps, jobId: string): Promise<Answer<FollowUpOutcome>> =>
  answer(async () => {
    const job = await jobOf(d, jobId);
    return runFollowUps(agentDeps(d), job.id);
  });

export const followUps = (d: Deps, walkId: string): Promise<Answer<JobsView>> =>
  answer(async () => {
    const walk = await walkOf(d, walkId);
    const deps = agentDeps(d);
    let capped: RateLimited | null = null;
    let ran = false;
    for (const job of await jobsForWalk(d.db, walk.id)) {
      try {
        ran ||= (await runFollowUps(deps, job.id)).ended !== "nothing_waiting";
      } catch (error) {
        if (!(error instanceof RateLimited)) throw error;
        capped ??= error;
      }
    }
    if (capped !== null && !ran) throw capped;
    return jobsView(d.db, walk.id);
  });

export const inspection = (d: Deps, walkId: string): Promise<Answer<Inspection>> =>
  answer(async () => {
    if (d.enabled) {
      const walk = await walkOf(d, walkId);
      if (!(await findingsForWalk(d.db, walk.id)).some((f) => f.label === "required_now" && f.veto === null)) throw new Refused(`walk ${walk.id} has no Required Now item`);
    }
    const request = await inspectionRequest({ enabled: d.enabled, db: d.db }, walkId);
    return { subject: request.subject, body: request.body, links: request.links.map(({ label, url }) => ({ label, url })) };
  });

export const optOut = (d: Deps, token: string): Promise<Answer<{ removed: true }>> =>
  answer(async () => {
    const config = mailConfig(d.env);
    const messageId = await messageOfToken(config.optoutSecret, token);
    if (messageId === null) throw notFound("that link");
    const message = await messageOf(d, messageId);
    const crew = (await jobCrews(d.db, message.jobId)).find((c) => c.id === message.crewId);
    if (crew === undefined) throw notFound(`crew ${message.crewId}`);
    const at = d.now().toISOString();
    if (crew.email !== null) await optOutAddress(d.db, crew.email, at);
    if (crew.licenseNumber !== null) await removeLicense(d.db, crew.licenseNumber, at.slice(0, 10));
    return { removed: true };
  });
