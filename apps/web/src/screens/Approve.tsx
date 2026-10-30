import { useEffect, useState } from "react";
import { draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import type { CrewCard, Message } from "../fixed-api.ts";
import { useStill } from "../live-results.ts";
import { shareWasCancelled, smsUrl } from "../phone.ts";
import { fixFor, ROUTES } from "../router.ts";
import type { ApproveIds } from "../router.ts";
import { useAction, useLoad } from "../use-load.ts";
import { Failed, Loading, Problem } from "./Failed.tsx";

type Outcome = "approved" | "sent" | "sent_by_phone" | "not_sent" | "unmarked" | null;

const Still = ({ url }: { url: string }) => {
  const src = useStill(url);
  return src === null ? null : <img src={src} alt="" />;
};

const ALREADY = new Set(["sent", "sent_by_phone", "replied"]);

const OneRequest = ({ walkId, message, crew }: { walkId: string; message: Message; crew: CrewCard | undefined }) => {
  const deps = useDeps();
  const action = useAction();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [approvedTo, setApprovedTo] = useState<{ phone: string; body: string } | null>(null);
  const finished = outcome === "sent" || outcome === "sent_by_phone" || ALREADY.has(message.status);
  const retry = message.status === "approved" || action.code === "send_failed";
  const textReady = message.channel === "text" && !finished && (approvedTo !== null || message.status === "approved");

  useEffect(() => {
    if (message.channel !== "text") return;
    let on = true;
    void Promise.all(message.photos.map((photo) => deps.stills(photo.url))).then((blobs) => {
      if (on) setFiles(blobs.flatMap((blob, i) => (blob === null ? [] : [new File([blob], `photo-${i + 1}.jpg`, { type: blob.type })])));
    });
    return () => {
      on = false;
    };
  }, [deps, message.id, message.channel]);

  const markSent = async () => {
    const marked = await action.run(() => deps.fixed.sentByPhone(message.id));
    setOutcome(marked === null ? "unmarked" : "sent_by_phone");
  };

  const openText = () => {
    const to = approvedTo?.phone ?? crew?.phone ?? "";
    const body = approvedTo?.body ?? message.body;
    const url = smsUrl(to, body);
    const share = files.length > 0 && deps.phone.canShareFiles(files);
    const sharing = share ? new Promise<void>((resolve) => resolve(deps.phone.share({ files, text: body }))) : null;
    if (sharing === null) deps.phone.openText(url);
    void (async () => {
      try {
        await sharing;
      } catch (error) {
        if (shareWasCancelled(error)) return setOutcome("not_sent");
        deps.phone.openText(url);
      }
      await markSent();
    })();
  };

  const approve = async () => {
    setOutcome(null);
    const approval = await action.run(() => deps.fixed.approve(message.id));
    if (approval === null) return;
    if (approval.status === "sent") return setOutcome("sent");
    setApprovedTo({ phone: approval.phone, body: approval.body });
    setOutcome("approved");
  };

  const label = message.channel === "text" ? draft.approve.text : retry ? draft.approve.again : draft.approve.email;
  return (
    <main className="screen approve" data-message={message.id}>
      <h1>{draft.approve.title}</h1>
      <h2>{crew?.name ?? ""}</h2>
      <p data-part="channel">
        {message.channel === "email" ? draft.approve.byEmail(crew?.email ?? null) : draft.approve.byText(crew?.phone ?? "")}
      </p>
      {message.subject === null ? null : <p data-part="subject">{draft.approve.subject(message.subject)}</p>}
      <p className="body" data-part="body">
        {message.body}
      </p>
      {message.photos.length === 0 ? null : (
        <section className="proofs">
          <h2>{draft.approve.photos}</h2>
          <div className="photos">
            {message.photos.map((photo) => (
              <Still key={photo.findingId} url={photo.url} />
            ))}
          </div>
        </section>
      )}
      {finished ? <p data-part="state">{outcome === "sent_by_phone" ? draft.approve.sentPhone : outcome === "sent" ? draft.approve.sentEmail : draft.fixed.message(message)}</p> : null}
      {outcome === "not_sent" ? <p role="status">{draft.approve.notSent}</p> : null}
      {action.code === "send_failed" ? <p role="status">{draft.approve.sendFailed}</p> : null}
      {action.code === null || action.code === "send_failed" ? null : <Problem code={action.code} />}
      {finished || outcome === "unmarked" || outcome === "not_sent" ? null : <p>{textReady ? draft.approve.approvedText : draft.approve.nothingSent}</p>}
      {finished ? null : outcome === "unmarked" ? (
        <button className="button primary" type="button" disabled={action.busy} onClick={() => void markSent()}>
          {draft.approve.markAgain}
        </button>
      ) : textReady ? (
        <button className="button primary" type="button" disabled={action.busy} onClick={openText}>
          {draft.approve.openText}
        </button>
      ) : (
        <button className="button primary" type="button" disabled={action.busy} onClick={() => void approve()}>
          {label}
        </button>
      )}
      <a className="button" href={fixFor(walkId)}>
        {draft.fixed.backToFix}
      </a>
    </main>
  );
};

export const Approve = ({ approveIds }: { approveIds: ApproveIds | null }) => {
  const deps = useDeps();
  const { loaded, retry } = useLoad(
    () => (approveIds === null ? Promise.resolve({ code: "not_found" as const, message: "" }) : deps.fixed.jobs(approveIds.walkId)),
    `${approveIds?.walkId}/${approveIds?.messageId}`,
  );

  useEffect(() => {
    if (approveIds === null) window.location.replace(ROUTES.home);
  }, [approveIds]);

  if (approveIds === null) return null;
  if (loaded.state === "loading")
    return (
      <main className="screen approve">
        <Loading />
      </main>
    );
  if (loaded.state === "failed")
    return (
      <main className="screen approve">
        <h1>{draft.approve.title}</h1>
        <Failed code={loaded.code} retry={retry} />
      </main>
    );
  const jobs = loaded.value.jobs;
  const job = jobs.find((j) => j.messages.some((m) => m.id === approveIds.messageId));
  const message = job?.messages.find((m) => m.id === approveIds.messageId);
  if (job === undefined || message === undefined)
    return (
      <main className="screen approve">
        <h1>{draft.approve.title}</h1>
        <p>{draft.approve.missing}</p>
        <a className="button" href={fixFor(approveIds.walkId)}>
          {draft.fixed.backToFix}
        </a>
      </main>
    );
  return <OneRequest walkId={approveIds.walkId} message={message} crew={job.crews.find((c) => c.id === message.crewId)} />;
};
