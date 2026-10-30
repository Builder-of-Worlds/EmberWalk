import { useCallback, useEffect, useRef, useState } from "react";
import type { Failure } from "../api.ts";
import { copy } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { progressOf } from "../progress.ts";
import type { Shown } from "../progress.ts";
import type { Clock } from "../recorder.ts";
import { resultsFor, ROUTES, sendFor } from "../router.ts";
import type { Sender } from "../sender.ts";
import type { Take, TakeStore } from "../take-store.ts";
import type { Progress, SendResult } from "../uploader.ts";
import { SIGNAL_RETRY_MS, watchWalk } from "../watch.ts";
import type { Online, Watched, WalkStatus } from "../watch.ts";
import { Trail } from "./Progress.tsx";

type Sending =
  | { kind: "ready" }
  | { kind: "sending"; progress: Progress }
  | { kind: "refused"; code: Failure }
  | { kind: "sent"; walkId: string };

const windowOnline: Online = {
  isOnline: () => navigator.onLine,
  onOnline: (run) => {
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  },
};

const keepTake = async (takes: () => Promise<TakeStore>, takeId: string | null): Promise<boolean> => {
  if (takeId === null) return false;
  try {
    const store = await takes();
    await store.saveUpload(takeId, null);
    await store.saveTags(takeId, { ids: [], sent: false, refusal: null });
    return true;
  } catch {
    return false;
  }
};

const ENDS_THE_CHECK: ReadonlySet<Watched["kind"]> = new Set(["done", "failed", "lost"]);

// The media container refuses the video itself: media_ plus its invalid_media, no_video, media_too_long and input_too_large.
const FAILS_AGAIN: ReadonlySet<string> = new Set([
  "not_mp4",
  "too_long",
  "no_frames",
  "real_footage_not_allowed",
  "media_invalid_media",
  "media_no_video",
  "media_media_too_long",
  "media_input_too_large",
]);

const resendable = (watched: Watched) => watched.kind !== "failed" || watched.code === null || !FAILS_AGAIN.has(watched.code);

export const OPENS_IN_MS = 1_500;

type CheckingProps = {
  walkId: string;
  opens: string;
  status: WalkStatus;
  clock: Clock;
  forget: () => void;
  keep: () => Promise<boolean>;
  resend: () => void;
};

const Checking = ({ walkId, opens, status, clock, forget, keep, resend }: CheckingProps) => {
  const [watched, setWatched] = useState<Watched>({ kind: "checking", state: { name: "queued" } });
  const [shown, setShown] = useState<Shown>(() => progressOf({ name: "queued" }));
  const [reported, setReported] = useState(false);
  const [kept, setKept] = useState<boolean | null>(null);
  const { reportFault, build, sentWalks } = useDeps();
  const partWalk = opens !== walkId;

  useEffect(() => {
    let cancelOpen = () => {};
    const told = new Set<string>();
    const stop = watchWalk(status, walkId, clock, (next) => {
      if (next.kind === "held" && !told.has(next.code)) {
        told.add(next.code);
        void reportFault({ walkId, code: next.code, build })
          .then((answer) => {
            if (answer.code === undefined) setReported(true);
          })
          .catch(() => undefined);
      }
      if (ENDS_THE_CHECK.has(next.kind)) {
        sentWalks.remove(walkId);
        if (next.kind === "done" || partWalk) forget();
        else if (!resendable(next)) {
          forget();
          setKept(false);
        } else void keep().then(setKept);
      }
      if (partWalk && (next.kind === "failed" || next.kind === "lost"))
        cancelOpen = clock.later(() => {
          window.location.hash = resultsFor(opens);
        }, OPENS_IN_MS);
      if (next.kind === "checking") setShown((before) => progressOf(next.state, before));
      if (next.kind === "done") {
        setShown((before) => progressOf({ name: "done" }, before));
        cancelOpen = clock.later(() => {
          window.location.hash = resultsFor(opens);
        }, OPENS_IN_MS);
      }
      setWatched(next);
    }, windowOnline);
    return () => {
      stop();
      cancelOpen();
    };
  }, [status, walkId, opens, partWalk, clock, forget, keep, reportFault, build, sentWalks]);

  if (watched.kind === "held")
    return (
      <>
        <h1>{copy.send.title}</h1>
        <p role="status">{copy.send.sent}</p>
        <p>{reported ? copy.send.reported : copy.send.held}</p>
      </>
    );
  if (watched.kind === "done")
    return (
      <>
        <h1>{copy.send.title}</h1>
        <Trail shown={shown} still={false} />
      </>
    );
  if (watched.kind === "checking" || watched.kind === "waiting")
    return (
      <>
        <h1>{copy.send.title}</h1>
        <p role="status">{copy.send.sent}</p>
        <p>{copy.send.refused.walk_not_done}</p>
        <Trail shown={shown} still={watched.kind === "waiting"} />
        {watched.kind === "waiting" ? <p role="alert">{copy.send.refused.offline}</p> : null}
      </>
    );
  const said = watched.kind === "failed" ? watched.message : partWalk || kept !== false ? null : copy.send.lost;
  return (
    <>
      <h1>{copy.send.title}</h1>
      {said === null ? null : <p role="alert">{said}</p>}
      {kept === true ? (
        <>
          <p>{copy.send.saved}</p>
          <button className="button primary" type="button" onClick={resend}>
            {copy.leaves.send}
          </button>
        </>
      ) : null}
      {kept === false ? (
        <a className="button" href={ROUTES.home}>
          {copy.send.back}
        </a>
      ) : null}
    </>
  );
};

const Saved = ({ take }: { take: Take }) => (
  <>
    <p role="status">{copy.send.saved}</p>
    {take.endedBy === "time_limit" ? <p>{copy.send.limitReached}</p> : null}
    {take.endedBy === "failed" ? <p>{copy.send.cameraStopped}</p> : null}
  </>
);

const NotNow = ({ onPress }: { onPress: () => void }) => (
  <>
    <a className="button" href={ROUTES.home} onClick={onPress}>
      {copy.leaves.notNow}
    </a>
    <p>{copy.leaves.later}</p>
  </>
);

const savedMinutes = (take: Take): number | null =>
  take.durationMs !== null && take.durationMs > 0 ? Math.ceil(take.durationMs / 60_000) : null;

const SendWalk = ({ take, send, clock, status }: { take: Take; send: Sender; clock: Clock; status: WalkStatus }) => {
  const { takes, sentWalks, prefs, abortUpload } = useDeps();
  const [sending, setSending] = useState<Sending>({ kind: "ready" });
  const forget = useCallback(() => {
    void takes()
      .then((store) => store.remove(take.id))
      .catch(() => undefined);
  }, [takes, take.id]);
  const keep = useCallback(() => keepTake(takes, take.id), [takes, take.id]);
  const keepOnPhone = useCallback(() => {
    void takes()
      .then(async (store) => {
        const { upload } = await store.get(take.id);
        if (upload === null || upload.uploadId === null) return;
        await abortUpload(upload.uploadId).catch(() => undefined);
        await store.dropUpload(take.id, upload.uploadId);
      })
      .catch(() => undefined);
  }, [takes, take.id, abortUpload]);
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSending({ kind: "sending", progress: { sentBytes: 0, totalBytes: take.bytes } });
    const result = await send(take, (progress) => setSending({ kind: "sending", progress })).catch(
      (): SendResult => ({ code: "server_error" }),
    );
    running.current = false;
    if (result.code === undefined)
      sentWalks.add({ walkId: result.walkId, opens: take.partOf?.walkId ?? result.walkId, takeId: take.id, createdAt: take.createdAt });
    setSending(result.code === undefined ? { kind: "sent", walkId: result.walkId } : { kind: "refused", code: result.code });
  }, [take, send, sentWalks]);

  const minutes = savedMinutes(take);
  const waiting = sending.kind === "refused" && sending.code === "offline";
  useEffect(() => {
    if (!waiting) return;
    const resume = () => void start();
    window.addEventListener("online", resume);
    const cancel = navigator.onLine ? clock.later(resume, SIGNAL_RETRY_MS) : () => undefined;
    return () => {
      window.removeEventListener("online", resume);
      cancel();
    };
  }, [waiting, start, clock]);

  const sendButton = (
    <button
      className="button primary"
      type="button"
      onClick={() => {
        prefs.markAgreedToSend();
        void start();
      }}
    >
      {copy.leaves.send}
    </button>
  );

  if (sending.kind === "ready")
    return (
      <>
        <h1>{copy.leaves.title}</h1>
        <Saved take={take} />
        <p>{copy.leaves.sent}</p>
        <p>{copy.leaves.never}</p>
        <p>{copy.leaves.meta}</p>
        {sendButton}
        <NotNow onPress={keepOnPhone} />
      </>
    );
  if (sending.kind === "sending")
    return (
      <>
        <h1>{copy.send.title}</h1>
        <p aria-live="polite">{copy.send.sending(sending.progress.sentBytes, sending.progress.totalBytes)}</p>
        <progress max={sending.progress.totalBytes} value={sending.progress.sentBytes} />
      </>
    );
  if (sending.kind === "sent")
    return (
      <Checking
        walkId={sending.walkId}
        opens={take.partOf?.walkId ?? sending.walkId}
        status={status}
        clock={clock}
        forget={forget}
        keep={keep}
        resend={() => void start()}
      />
    );
  return (
    <>
      <h1>{copy.send.title}</h1>
      <p role="alert">{copy.send.refused[sending.code]}</p>
      {waiting && minutes !== null ? <p>{copy.send.savedMinutes(minutes)}</p> : null}
      <Saved take={take} />
      {sendButton}
      <NotNow onPress={keepOnPhone} />
    </>
  );
};

const NoWalk = () => (
  <>
    <h1>{copy.send.title}</h1>
    <p>{copy.send.none}</p>
    <a className="button primary" href={ROUTES.record}>
      {copy.send.recordWalk}
    </a>
    <a className="button" href={ROUTES.home}>
      {copy.send.back}
    </a>
  </>
);

export const CheckingWalk = ({ walkId = null }: { walkId?: string | null }) => {
  const { takes, walkStatus, clock, sentWalks } = useDeps();
  const [sent] = useState(() => (walkId === null ? null : sentWalks.get(walkId)));
  const forget = useCallback(() => {
    if (sent === null) return;
    void takes()
      .then((store) => store.remove(sent.takeId))
      .catch(() => undefined);
  }, [takes, sent]);
  const keep = useCallback(() => keepTake(takes, sent?.takeId ?? null), [takes, sent]);
  const resend = useCallback(() => {
    if (sent !== null) window.location.hash = sendFor(sent.takeId);
  }, [sent]);
  return (
    <main className="screen">
      {walkId === null ? (
        <NoWalk />
      ) : (
        <Checking walkId={walkId} opens={sent?.opens ?? walkId} status={walkStatus} clock={clock} forget={forget} keep={keep} resend={resend} />
      )}
    </main>
  );
};

export const Send = ({ takeId = null }: { takeId?: string | null }) => {
  const deps = useDeps();
  const [take, setTake] = useState<Take | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void deps
      .takes()
      .then((takes) => (takeId === null ? takes.latest() : takes.get(takeId).catch(() => null)))
      .then((found) => {
        if (live) setTake(found);
      });
    return () => {
      live = false;
    };
  }, [deps, takeId]);

  return (
    <main className="screen">
      {take ? <SendWalk take={take} send={deps.send} clock={deps.clock} status={deps.walkStatus} /> : null}
      {take === null ? <NoWalk /> : null}
    </main>
  );
};
