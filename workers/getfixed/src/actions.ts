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
  sendInspection,
  withWork,
} from "@emberwalk/agent";
import {
  approveInspection as approveStored,
  addNamedCrew,
  addressOptedOut,
  approveMessage,
  CapReached,
  confirmCrewSignup,
  DbRefused,
  findingsForWalk,
  followUpsForJob,
  getInspection,
  getJob,
  getMessage,
  getWalk,
  inspectionRepliesFor,
  jobAddress,
  jobCrews,
  jobsForWalk,
  licenseOnStateList,
  markSent,
  messagesForJob,
  saveDraft,
  optOutAddress,
  removeCrewSignup,
  removeLicense,
  saveCrewCards,
  saveCrewSignup,
  saveInspectionDraft,
  saveReply,
  setCrewEmail,
  setJobStatus,
} from "@emberwalk/db";
import { fireContactFor } from "@emberwalk/directory";
import { MetaHttpError, MetaRefused } from "@emberwalk/meta";
import { CrewSignupRequest, type CrewSignupResponse, type FixedApprovalResponse, type FixedCode, type FixedInspectionResponse, type FixedInspectionSentResponse, FixedNamedCrewRequest, type FixedSentByPhoneResponse, type OutgoingMessage } from "@emberwalk/shared";
import { z } from "zod";
import { type Deps, ModelOff } from "./deps.ts";
import { directoryFor } from "./directory.ts";
import { MailFailed, MailOff, mailConfig, messageOfToken, resendInspection, resendOutbox, sendCrewConfirm, signupOfToken } from "./mail.ts";
import { jobsView, type JobsView } from "./view.ts";

export const MAX_APPROVED_EMAILS_PER_DAY = 25;
export const MAX_SIGNUPS_PER_DAY = 100;

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
    const request = await inspectionRequest({ enabled: d.enabled, db: d.db, contactFor: fireContactFor }, walkId);
    const links = request.links.map(({ label, url }) => ({ label, url }));
    const { contact } = request;
    if (contact === null) return { subject: request.subject, body: request.body, links, contact: null, messageId: null, sent: false, replies: [] };
    const saved = await saveInspectionDraft(d.db, {
      id: d.newId(),
      walkId,
      agency: contact.agency,
      toAddress: contact.email,
      source: contact.source,
      readOn: contact.readOn,
      subject: request.subject,
      body: request.body,
      createdAt: d.now().toISOString(),
    });
    return { subject: saved.subject, body: saved.body, links, contact, messageId: saved.id, sent: saved.status === "sent", replies: await inspectionRepliesFor(d.db, saved.id) };
  });

export const approveInspection = (d: Deps, messageId: string, visitorId: string): Promise<Answer<FixedInspectionSentResponse>> =>
  answer(async () => {
    const message = await getInspection(d.db, messageId);
    if (message === null) throw notFound(`inspection message ${messageId}`);
    const walk = await walkOf(d, message.walkId);
    if (message.status === "sent") return { status: "sent" };
    const config = mailConfig(d.env);
    const firstJob = (await jobsForWalk(d.db, walk.id))[0];
    if (firstJob === undefined) throw new Refused(`walk ${walk.id} has no job address`);
    if (message.status === "draft") await approveStored(d.db, message.id, d.now().toISOString(), visitorId, MAX_APPROVED_EMAILS_PER_DAY);
    const jobToken = await jobAddress(d.db, firstJob.id, d.newToken, d.now().toISOString());
    await sendInspection({ db: d.db, outbox: resendInspection({ db: d.db, config, fetch: d.fetch, now: d.now, jobToken }), now: d.now }, message.id);
    return { status: "sent" };
  });

export const crewSignup = (d: Deps, input: unknown): Promise<Answer<CrewSignupResponse>> =>
  answer(async () => {
    const signup = CrewSignupRequest.parse(input);
    if (!(await licenseOnStateList(d.db, signup.licenseNumber, signup.licenseClass))) throw new Refused(`license ${signup.licenseNumber} ${signup.licenseClass} is not on the state list in good standing`);
    const config = mailConfig(d.env);
    const saved = await saveCrewSignup(d.db, signup, { id: d.newId(), at: d.now().toISOString(), perDay: MAX_SIGNUPS_PER_DAY });
    if (saved.outcome === "license_listed" || saved.outcome === "license_waiting") return { status: saved.outcome };
    if (saved.outcome === "send") await sendCrewConfirm({ config, fetch: d.fetch, now: d.now }, saved.id, saved.email);
    return { status: "check_email" };
  });

export const crewConfirm = (d: Deps, token: string): Promise<Answer<{ listed: true }>> =>
  answer(async () => {
    const signupId = await signupOfToken(mailConfig(d.env).optoutSecret, token);
    if (signupId === null || !(await confirmCrewSignup(d.db, signupId, d.now().toISOString()))) throw notFound("that link");
    return { listed: true };
  });

// Draft words: they wait for the owner's approval.
const TEXT_REQUEST: Record<string, string> = {
  en: "Hello, I would like a quote for this work at my home.",
  es: "Hola, quisiera un presupuesto para este trabajo en mi casa.",
};

export const textDraft = (d: Deps, jobId: string, crewId: string): Promise<Answer<JobsView>> =>
  answer(async () => {
    const job = await jobOf(d, jobId);
    const walk = await walkOf(d, job.walkId);
    const crew = (await jobCrews(d.db, job.id)).find((c) => c.id === crewId);
    if (crew?.phone == null) throw new SendRefused(`crew ${crewId} has no phone number on this job`);
    if (crew.email !== null && (await addressOptedOut(d.db, crew.email))) throw new SendRefused(`crew ${crewId} asked to be taken off the list`);
    const waiting = (await messagesForJob(d.db, job.id)).some((m) => m.crewId === crewId && m.channel === "text" && (m.status === "draft" || m.status === "approved"));
    if (!waiting) {
      const findings = (await findingsForWalk(d.db, job.walkId)).filter((f) => job.findingIds.includes(f.id));
      await saveDraft(d.db, { id: d.newId(), jobId: job.id, crewId, channel: "text", subject: null, body: withWork(TEXT_REQUEST[walk.language] ?? TEXT_REQUEST["en"]!, findings, job.zip), createdAt: d.now().toISOString() });
    }
    return jobsView(d.db, walk.id);
  });

export const addCrew = (d: Deps, jobId: string, input: unknown): Promise<Answer<JobsView>> =>
  answer(async () => {
    const job = await jobOf(d, jobId);
    const named = FixedNamedCrewRequest.parse(input);
    await addNamedCrew(d.db, job.id, { id: d.newId(), name: named.name, trade: job.trade, zip: job.zip, email: named.email, phone: named.phone, licenseNumber: null, sample: false });
    return jobsView(d.db, job.walkId);
  });

export const optOut = (d: Deps, token: string): Promise<Answer<{ removed: true }>> =>
  answer(async () => {
    const config = mailConfig(d.env);
    const messageId = await messageOfToken(config.optoutSecret, token);
    if (messageId === null) {
      const signupId = await signupOfToken(config.optoutSecret, token, "signup-optout");
      const address = signupId === null ? null : await removeCrewSignup(d.db, signupId);
      if (address === null) throw notFound("that link");
      await optOutAddress(d.db, address, d.now().toISOString());
      return { removed: true };
    }
    const message = await messageOf(d, messageId);
    const crew = (await jobCrews(d.db, message.jobId)).find((c) => c.id === message.crewId);
    if (crew === undefined) throw notFound(`crew ${message.crewId}`);
    const at = d.now().toISOString();
    if (crew.email !== null) await optOutAddress(d.db, crew.email, at);
    if (crew.licenseNumber !== null) await removeLicense(d.db, crew.licenseNumber, at.slice(0, 10));
    return { removed: true };
  });
