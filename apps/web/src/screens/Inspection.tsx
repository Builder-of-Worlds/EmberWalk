import { useEffect, useState } from "react";
import { draft, shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { inspectionWords } from "../draft-words.ts";
import type { InspectionRequest } from "../fixed-api.ts";
import { JUDGE, judgeWords } from "../judge.ts";
import { localDay } from "../mark-sync.ts";
import { fixFor, ROUTES } from "../router.ts";
import { SAMPLES } from "../samples.ts";
import { SignInAgain } from "./SignInAgain.tsx";
import { useAction, useLoad } from "../use-load.ts";
import { Failed, Problem } from "./Failed.tsx";

export const CALFIRE_FORM_URL = "https://survey123.arcgis.com/share/a15c7706b4114e20b39d2a26294338ed";

type Contact = NonNullable<InspectionRequest["contact"]>;

const Department = ({ request, contact, messageId }: { request: InspectionRequest; contact: Contact; messageId: string }) => {
  const { fixed } = useDeps();
  const action = useAction();
  const [sent, setSent] = useState(request.sent);
  const send = async () => {
    if ((await action.run(() => fixed.inspectionApprove(messageId))) !== null) setSent(true);
  };
  return (
    <section className="department">
      <p data-part="department">{inspectionWords.goesTo(contact.agency, contact.email)}</p>
      <p>
        <a data-part="source" href={contact.source} target="_blank" rel="noreferrer">
          {inspectionWords.source}
        </a>
      </p>
      <p data-part="read-on">{inspectionWords.readOn(shortDay(contact.readOn))}</p>
      {sent ? <p role="status">{inspectionWords.sent(contact.agency)}</p> : <p>{inspectionWords.nothingSent}</p>}
      {action.busy ? <p role="status">{inspectionWords.sending}</p> : null}
      {action.code === "send_failed" ? <p role="status">{draft.approve.sendFailed}</p> : null}
      {action.code === null || action.code === "send_failed" ? null : <Problem code={action.code} />}
      {sent ? null : (
        <button className="button primary" type="button" disabled={action.busy} onClick={() => void send()}>
          {inspectionWords.email}
        </button>
      )}
      {request.replies.length === 0 ? null : (
        <div className="replies">
          <h2>{inspectionWords.replied}</h2>
          {request.replies.map((reply) => (
            <p key={reply.id} className="said" data-part="department-reply">
              {reply.text}
            </p>
          ))}
        </div>
      )}
    </section>
  );
};

const Ready = ({ walkId, request }: { walkId: string; request: InspectionRequest }) => {
  const { phone } = useDeps();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => setCopied(await phone.copy(`${request.subject}\n\n${request.body}`));
  return (
    <main className="screen inspection" data-ready="true">
      <h1>{draft.inspection.title}</h1>
      <p>{draft.inspection.intro}</p>
      <p data-part="subject">{draft.inspection.subject(request.subject)}</p>
      <p className="body" data-part="body">
        {request.body}
      </p>
      <button className="button primary" type="button" onClick={() => void copy()}>
        {draft.inspection.copy}
      </button>
      {copied === null ? null : <p role="status">{copied ? draft.inspection.copied : draft.inspection.copyFailed}</p>}
      <a className="button" data-part="calfire-form" href={CALFIRE_FORM_URL} target="_blank" rel="noreferrer">
        {inspectionWords.openForm}
      </a>
      {request.contact !== null && request.messageId !== null ? <Department request={request} contact={request.contact} messageId={request.messageId} /> : null}
      {request.links.length === 0 ? null : (
        <section className="links">
          <h2>{draft.inspection.links}</h2>
          <ul className="lines">
            {request.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <a className="button" href={fixFor(walkId)}>
        {draft.fixed.backToFix}
      </a>
    </main>
  );
};

export const Inspection = ({ inspectionId }: { inspectionId: string | null }) => {
  const deps = useDeps();
  const { loaded, retry } = useLoad(
    () => (inspectionId === null ? Promise.resolve({ code: "not_found" as const, message: "" }) : deps.fixed.inspection(inspectionId)),
    inspectionId ?? "",
  );

  useEffect(() => {
    if (inspectionId === null) window.location.replace(ROUTES.home);
  }, [inspectionId]);

  if (inspectionId === null) return null;
  if (loaded.state === "ready") return <Ready walkId={inspectionId} request={loaded.value} />;
  const failed = loaded.state === "failed" ? loaded.code : null;
  return (
    <main className="screen inspection" data-ready="false">
      <h1>{failed === "not_ready" ? draft.inspection.notReady : draft.inspection.title}</h1>
      <SignInAgain />
      {loaded.state === "loading" ? <p>{draft.inspection.writing}</p> : null}
      {failed === "not_ready" ? <Problem code={failed} /> : null}
      {failed === "not_ready" && JUDGE ? (
        <button
          className="button primary"
          type="button"
          onClick={() => {
            for (const finding of SAMPLES[0]!.findings) deps.marks.setStatus(inspectionId, finding.id, "done", "", localDay(deps.clock.now()));
            retry();
          }}
        >
          {judgeWords.markAll}
        </button>
      ) : null}
      {failed === "conflict" ? <p className="problem" role="status">{draft.inspection.noRequired}</p> : null}
      {failed !== null && failed !== "not_ready" && failed !== "conflict" ? <Failed code={failed} retry={retry} /> : null}
      <a className="button" href={fixFor(inspectionId)}>
        {draft.fixed.backToFix}
      </a>
    </main>
  );
};
