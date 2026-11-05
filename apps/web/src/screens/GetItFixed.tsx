import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { copy, draft, shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { DEMO_ADDRESS } from "../demo-fixed.ts";
import { crewWords, demoWords, phoneOf, signInAgainNoted } from "../draft-words.ts";
import { SignInAgain } from "./SignInAgain.tsx";
import type { CrewCard, FollowUp, Job, JobsView, Message, Reply } from "../fixed-api.ts";
import { localDay } from "../mark-sync.ts";
import { instructionOf } from "../results.ts";
import type { WalkResults } from "../results.ts";
import { approveFor, inspectionFor, resultsFor, ROUTES } from "../router.ts";
import { JUDGE, judgeWords } from "../judge.ts";
import { isSample } from "../samples.ts";
import { useAction, useLoad } from "../use-load.ts";
import { Failed, Loading, Problem } from "./Failed.tsx";

type Say = (finding: string) => string | null;

type Change = (view: JobsView) => void;

const ZIP = /^\d{5}$/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// USPS DMM L002 (rev. Apr. 6, 2009, read Nov. 1, 2026) lists 900 to 960 as CA; 961 is listed under Reno, NV, but holds Truckee, CA.
const inCalifornia = (zip: string): boolean => {
  const prefix = Number(zip.slice(0, 3));
  return prefix >= 900 && prefix <= 961;
};

const ZipForm = ({ walkId, onView, again = false }: { walkId: string; onView: Change; again?: boolean }) => {
  const { fixed } = useDeps();
  const [zip, setZip] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [outside, setOutside] = useState<string | null>(null);
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const entered = zip.trim();
    setInvalid(!ZIP.test(entered));
    setOutside(ZIP.test(entered) && !inCalifornia(entered) ? entered : null);
    if (!ZIP.test(entered) || !inCalifornia(entered)) return;
    const view = await action.run(() => fixed.plan(walkId, entered));
    if (view !== null) onView(view);
  };
  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      {again ? <p>{draft.fixed.zipRetry}</p> : null}
      <label htmlFor="zip">{draft.fixed.zipLabel}</label>
      <input id="zip" type="text" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value)} />
      {invalid ? <p role="status">{draft.fixed.zipInvalid}</p> : null}
      {outside === null ? null : (
        <div role="status">
          <p>{draft.fixed.zipOutside(outside)}</p>
          <p>{copy.record.location.outside}</p>
        </div>
      )}
      {action.code === null ? null : <Problem code={action.code} />}
      {action.busy ? <p role="status">{draft.fixed.finding}</p> : null}
      <button className="button primary" type="submit" disabled={action.busy}>
        {draft.fixed.zipButton}
      </button>
    </form>
  );
};

const AddEmail = ({ job, crew, onView }: { job: Job; crew: CrewCard; onView: Change }) => {
  const { fixed } = useDeps();
  const [email, setEmail] = useState("");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() === "") return;
    const view = await action.run(() => fixed.addEmail(job.id, crew.id, email.trim()));
    if (view !== null) onView(view);
  };
  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`email-${crew.id}`}>{draft.fixed.emailLabel(crew.name)}</label>
      <input id={`email-${crew.id}`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      {action.code === "conflict" ? <p role="status">{draft.fixed.emailLocked}</p> : null}
      {action.code === null || action.code === "conflict" ? null : <Problem code={action.code} />}
      <button className="button" type="submit" disabled={action.busy}>
        {draft.fixed.addEmail}
      </button>
    </form>
  );
};

const NameCrew = ({ job, onView }: { job: Job; onView: Change }) => {
  const { fixed } = useDeps();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [unread, setUnread] = useState(false);
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const typed = contact.trim();
    const email = EMAIL.test(typed) ? typed : null;
    const phone = email === null ? phoneOf(typed) : null;
    setUnread(email === null && phone === null);
    if ((email === null && phone === null) || name.trim() === "") return;
    const view = await action.run(() => fixed.addCrew(job.id, { name: name.trim(), email, phone }));
    if (view === null) return;
    setName("");
    setContact("");
    onView(view);
  };
  return (
    <form className="form" data-part="name-crew" onSubmit={(event) => void submit(event)} noValidate>
      <h3>{crewWords.nameYours}</h3>
      <label htmlFor={`crew-name-${job.id}`}>{crewWords.crewName}</label>
      <input id={`crew-name-${job.id}`} name="name" type="text" autoComplete="off" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor={`crew-contact-${job.id}`}>{crewWords.crewContact}</label>
      <input id={`crew-contact-${job.id}`} name="contact" type="text" autoComplete="off" maxLength={254} value={contact} onChange={(e) => setContact(e.target.value)} />
      {unread ? <p role="status">{crewWords.needContact}</p> : null}
      {action.code === "conflict" ? <p role="status">{crewWords.crewRefused}</p> : null}
      {action.code === null || action.code === "conflict" ? null : <Problem code={action.code} />}
      <button className="button" type="submit" disabled={action.busy}>
        {crewWords.addCrew}
      </button>
    </form>
  );
};

const textWaiting = (job: Job, crewId: string) => job.messages.find((m) => m.crewId === crewId && m.channel === "text" && (m.status === "draft" || m.status === "approved"));

const TextCrew = ({ walkId, job, crew, onView }: { walkId: string; job: Job; crew: CrewCard; onView: Change }) => {
  const { fixed } = useDeps();
  const action = useAction();
  const waiting = textWaiting(job, crew.id);
  if (waiting !== undefined) {
    return (
      <a className="button" href={approveFor(walkId, waiting.id)}>
        {draft.fixed.text}
      </a>
    );
  }
  const ask = async () => {
    const view = await action.run(() => fixed.textDraft(job.id, crew.id));
    if (view === null) return;
    onView(view);
    const made = textWaiting(view.jobs.find((j) => j.id === job.id) ?? job, crew.id);
    if (made !== undefined) window.location.hash = approveFor(walkId, made.id);
  };
  return (
    <>
      <button className="button" type="button" disabled={action.busy} onClick={() => void ask()}>
        {draft.fixed.text}
      </button>
      {action.code === null ? null : <Problem code={action.code} />}
    </>
  );
};

const Crew = ({ walkId, job, crew, canAddEmail, onView }: { walkId: string; job: Job; crew: CrewCard; canAddEmail: boolean; onView: Change }) => (
  <li className="crew" data-crew={crew.id}>
    <h3>{crew.name}</h3>
    {crew.sample ? <p data-part="sample">{draft.fixed.sample}</p> : null}
    {crew.className === null ? null : <p data-part="class">{crew.className}</p>}
    {crew.distanceMiles === null ? null : <p data-part="distance">{draft.fixed.distance(crew.distanceMiles, crew.approximate)}</p>}
    {crew.licenseStatus === null ? null : <p data-part="license">{draft.fixed.license(crew.licenseStatus, crew.listedOn)}</p>}
    {crew.email === null ? null : <p data-part="email">{draft.fixed.emailOf(crew.email)}</p>}
    <div className="actions">
      {crew.phone === null ? null : (
        <>
          <a className="button" href={`tel:${crew.phone}`}>
            {copy.fixed.call}
          </a>
          <TextCrew walkId={walkId} job={job} crew={crew} onView={onView} />
        </>
      )}
      {crew.checkLicenseUrl === null ? null : (
        <a className="button" href={crew.checkLicenseUrl} target="_blank" rel="noreferrer">
          {copy.fixed.checkLicense}
        </a>
      )}
    </div>
    {crew.email === null && canAddEmail ? <AddEmail job={job} crew={crew} onView={onView} /> : null}
  </li>
);

const Reading = ({ reply }: { reply: Reply }) =>
  reply.reading === null ? null : (
    <div className="reading" data-part="reading">
      <p className="who">{draft.fixed.read}</p>
      <p>{reply.reading.summary}</p>
      {reply.reading.price === null ? null : <p>{draft.fixed.price(reply.reading.price)}</p>}
      {reply.reading.date === null ? null : <p>{draft.fixed.date(reply.reading.date)}</p>}
      {reply.reading.questions.length === 0 ? null : (
        <>
          <p className="who">{draft.fixed.questions}</p>
          <ul>
            {reply.reading.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </>
      )}
      {reply.reading.declined ? <p>{draft.fixed.declined}</p> : null}
    </div>
  );

const ReplyForm = ({ message, onView }: { message: Message; onView: Change }) => {
  const { fixed } = useDeps();
  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setEmpty(text.trim() === "");
    if (text.trim() === "") return;
    const view = await action.run(() => fixed.logReply(message.id, text.trim()));
    if (view === null) return;
    setText("");
    onView(view);
  };
  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`reply-${message.id}`}>{draft.fixed.replyLabel}</label>
      <textarea id={`reply-${message.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="help">{draft.fixed.replyHelp}</p>
      {empty ? <p role="status">{draft.fixed.replyEmpty}</p> : null}
      {action.code === null ? null : <Problem code={action.code} />}
      <button className="button" type="submit" disabled={action.busy}>
        {draft.fixed.logReply}
      </button>
    </form>
  );
};

const LOGGABLE = new Set(["sent", "sent_by_phone", "replied"]);

const Request = ({ walkId, job, message, onView }: { walkId: string; job: Job; message: Message; onView: Change }) => {
  const crew = job.crews.find((c) => c.id === message.crewId);
  const waiting = message.status === "draft" || message.status === "approved";
  return (
    <li className="message" data-message={message.id}>
      <h3>{crew?.name ?? ""}</h3>
      <p data-part="state">{draft.fixed.message(message)}</p>
      {waiting ? (
        <a className="button primary" href={approveFor(walkId, message.id)}>
          {draft.fixed.review}
        </a>
      ) : null}
      {message.replies.length === 0 ? null : (
        <div className="replies">
          <h3>{draft.fixed.replies}</h3>
          {message.replies.map((reply) => (
            <div key={reply.id} className="reply" data-reply={reply.id}>
              {JUDGE && reply.via === "email" ? <p data-part="demo-inbox">{judgeWords.inbox}</p> : null}
              <p className="who">{`${draft.fixed.replyVia[reply.via]}, ${shortDay(localDay(Date.parse(reply.receivedAt)))}`}</p>
              <p className="said">{reply.text}</p>
              <Reading reply={reply} />
            </div>
          ))}
        </div>
      )}
      {LOGGABLE.has(message.status) ? <ReplyForm message={message} onView={onView} /> : null}
    </li>
  );
};

const Reminders = ({ walkId, followUps }: { walkId: string; followUps: FollowUp[] }) => (
  <div className="reminders">
    <h3>{draft.fixed.reminders}</h3>
    <ul className="lines">
      {followUps.map((followUp) => (
        <li key={followUp.id} data-followup={followUp.id}>
          {followUp.draftMessageId === null ? (
            <p>{draft.fixed.reminderDue(shortDay(localDay(Date.parse(followUp.dueAt))))}</p>
          ) : (
            <>
              <p>{draft.fixed.reminderReady(shortDay(localDay(Date.parse(followUp.dueAt))))}</p>
              <a className="button primary" href={approveFor(walkId, followUp.draftMessageId)}>
                {draft.fixed.reviewReminder}
              </a>
            </>
          )}
          {followUp.note === "" ? null : <p>{followUp.note}</p>}
        </li>
      ))}
    </ul>
  </div>
);

const JobCard = ({ walkId, job, say, onView }: { walkId: string; job: Job; say: Say; onView: Change }) => {
  const { fixed } = useDeps();
  const action = useAction();
  const open = job.followUps.filter((f) => !f.done);
  const asked = new Set(job.messages.map((m) => m.crewId));
  const sentences = [
    ...new Set(
      job.findingIds.flatMap((id) => {
        const said = say(id);
        return said === null ? [] : [said];
      }),
    ),
  ];
  const write = async () => {
    const view = await action.run(() => fixed.draft(job.id));
    if (view !== null) onView(view);
  };
  return (
    <section className="job" data-job={job.id} data-trade={job.trade}>
      <h2>{draft.fixed.trade[job.trade]}</h2>
      <p data-part="job-state">{draft.fixed.job[job.status]}</p>
      <p>{draft.fixed.itemsOnList(job.findingIds.length)}</p>
      {sentences.length === 0 ? null : (
        <ul className="lines sentences">
          {sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      )}
      {job.crews.length === 0 ? <p>{draft.fixed.noCrews}</p> : null}
      <ul className="crews">
        {job.crews.map((crew) => (
          <Crew key={crew.id} walkId={walkId} job={job} crew={crew} canAddEmail={!asked.has(crew.id)} onView={onView} />
        ))}
      </ul>
      {job.messages.length === 0 ? <NameCrew job={job} onView={onView} /> : null}
      {job.crews.length > 0 && job.messages.length === 0 ? (
        <>
          {action.code === null ? null : <Problem code={action.code} />}
          {action.busy ? <p role="status">{draft.fixed.writing}</p> : null}
          <button className="button primary" type="button" disabled={action.busy} onClick={() => void write()}>
            {draft.fixed.writeRequests}
          </button>
        </>
      ) : null}
      {job.messages.length === 0 ? null : (
        <>
          <h3>{draft.fixed.requests}</h3>
          <ul className="messages">
            {job.messages.map((message) => (
              <Request key={message.id} walkId={walkId} job={job} message={message} onView={onView} />
            ))}
          </ul>
        </>
      )}
      {open.length === 0 ? null : <Reminders walkId={walkId} followUps={open} />}
    </section>
  );
};

const Jobs = ({ walkId, view, say, onView }: { walkId: string; view: JobsView; say: Say; onView: Change }) => {
  const { fixed } = useDeps();
  const action = useAction();
  const [checked, setChecked] = useState(false);
  const waitingOnCrews = view.jobs.some((job) => job.status === "waiting_on_crew");
  const remind = async () => {
    const next = await action.run(() => fixed.followUps(walkId));
    if (next === null) return;
    setChecked(true);
    onView(next);
  };
  return (
    <>
      {view.jobs.some((job) => job.crews.length > 0) ? <p className="lead">{JUDGE ? judgeWords.crews : copy.fixed.honest}</p> : null}
      {view.jobs.map((job) => (
        <JobCard key={job.id} walkId={walkId} job={job} say={say} onView={onView} />
      ))}
      {view.yourself.length === 0 ? null : (
        <section className="yourself">
          <h2>{draft.fixed.yourself}</h2>
          <p>{draft.fixed.yourselfLine}</p>
          <ul className="lines sentences">
            {view.yourself.flatMap((id) => {
              const said = say(id);
              return said === null ? [] : [<li key={id}>{said}</li>];
            })}
          </ul>
        </section>
      )}
      {waitingOnCrews ? (
        <section className="remind">
          {action.code === null ? null : <Problem code={action.code} />}
          {checked ? <p role="status">{draft.fixed.remindersChecked}</p> : null}
          <button className="button" type="button" disabled={action.busy} onClick={() => void remind()}>
            {draft.fixed.writeReminders}
          </button>
        </section>
      ) : null}
    </>
  );
};

const DemoInbox = ({ view }: { view: JobsView }) => {
  const arrived = view.jobs.flatMap((job) => job.messages.filter((m) => m.sentAt !== null));
  if (arrived.length === 0) return null;
  return (
    <section className="job" data-part="demo-inbox">
      <h2>{demoWords.inboxTitle}</h2>
      <p>{demoWords.inboxLead}</p>
      {arrived.map((message) => (
        <div key={message.id} className="reply" data-part="inbox-message">
          <p className="who">{demoWords.to(DEMO_ADDRESS)}</p>
          <p className="who">{message.subject}</p>
          <p className="said">{message.body}</p>
        </div>
      ))}
    </section>
  );
};

const useResults = (walkId: string | null): WalkResults | null | undefined => {
  const deps = useDeps();
  const [results, setResults] = useState<WalkResults | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (walkId === null) return;
    void deps
      .results(walkId)
      .then((found) => live && setResults(found))
      .catch(() => live && setResults(null));
    return () => {
      live = false;
    };
  }, [deps, walkId]);
  return results;
};

const NOT_PLANNED = new Set(["not_found", "unknown_walk"]);

export const GetItFixed = ({ fixId }: { fixId: string | null }) => {
  const deps = useDeps();
  const results = useResults(fixId);
  const sample = fixId !== null && isSample(fixId);
  const demo = sample || results?.synthetic === true;
  const { loaded, retry, set } = useLoad(async () => (fixId === null ? { code: "not_found" as const, message: "" } : deps.fixed.jobs(fixId)), fixId ?? "");

  useEffect(() => {
    if (fixId === null) window.location.replace(ROUTES.home);
  }, [fixId]);

  if (fixId === null) return null;
  const say: Say = (id) => {
    const finding = results?.findings.find((f) => f.id === id);
    return finding === undefined ? null : instructionOf(finding);
  };
  const planned = loaded.state === "ready" && (loaded.value.jobs.length > 0 || loaded.value.yourself.length > 0);
  const unplanned = loaded.state === "ready" ? !planned : loaded.state === "failed" && NOT_PLANNED.has(loaded.code) && !signInAgainNoted();

  return (
    <main className="screen fix" data-walk={fixId}>
      <h1>{draft.fixed.title}</h1>
      <p>{draft.fixed.nothingGoesOut}</p>
      <SignInAgain />
      {loaded.state === "loading" ? <Loading /> : null}
      {loaded.state === "failed" && !unplanned ? <Failed code={loaded.code} retry={retry} /> : null}
      {unplanned && results !== undefined ? <ZipForm walkId={fixId} onView={set} /> : null}
      {loaded.state === "ready" && planned ? <Jobs walkId={fixId} view={loaded.value} say={say} onView={set} /> : null}
      {loaded.state === "ready" && loaded.value.jobs.length > 0 && loaded.value.jobs.every((job) => job.crews.length === 0) ? <ZipForm walkId={fixId} onView={set} again /> : null}
      {demo && loaded.state === "ready" ? <DemoInbox view={loaded.value} /> : null}
      {planned ? (
        <section className="inspection-ask">
          <p>{draft.fixed.inspectionLine}</p>
          <a className="button" href={inspectionFor(fixId)}>
            {draft.fixed.inspection}
          </a>
        </section>
      ) : null}
      <a className="button" href={resultsFor(fixId)}>
        {draft.fixed.backToResults}
      </a>
    </main>
  );
};
