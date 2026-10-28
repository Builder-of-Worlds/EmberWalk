import { useCallback, useEffect, useRef, useState } from "react";
import type { Failure } from "../api.ts";
import { copy } from "../copy.ts";
import { useDeps } from "../deps.ts";
import type { Clock } from "../recorder.ts";
import { resultsFor, ROUTES } from "../router.ts";
import type { Sender } from "../sender.ts";
import type { Take } from "../take-store.ts";
import type { Progress, SendResult } from "../uploader.ts";
import { SIGNAL_RETRY_MS, watchWalk } from "../watch.ts";
import type { Online, Watched, WalkStatus } from "../watch.ts";

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

const RecordWalk = () => (
  <a className="button primary" href={ROUTES.record}>
    {copy.send.recordWalk}
  </a>
);

const HOLDS_THE_WALK: ReadonlySet<Watched["kind"]> = new Set(["waiting", "held"]);

type CheckingProps = { walkId: string; opens: string; status: WalkStatus; clock: Clock; forget: () => void };

const Checking = ({ walkId, opens, status, clock, forget }: CheckingProps) => {
  const [watched, setWatched] = useState<Exclude<Watched, { kind: "done" }>>({ kind: "checking", state: { name: "queued" } });
  const [reported, setReported] = useState(false);
  const { reportFault, build } = useDeps();

  useEffect(() => {
    let forgotten = false;
    const told = new Set<string>();
    return watchWalk(status, walkId, clock, (next) => {
      if (next.kind === "held" && !told.has(next.code)) {
        told.add(next.code);
        void reportFault({ walkId, code: next.code, build })
          .then((answer) => {
            if (answer.code === undefined) setReported(true);
          })
          .catch(() => undefined);
      }
      if (!forgotten && !HOLDS_THE_WALK.has(next.kind)) {
        forgotten = true;
        forget();
      }
      if (next.kind === "done") window.location.hash = resultsFor(opens);
      else setWatched(next);
    }, windowOnline);
  }, [status, walkId, opens, clock, forget, reportFault, build]);

  if (watched.kind === "held")
    return (
      <>
        <h1>{copy.send.title}</h1>
        <p role="status">{copy.send.sent}</p>
        <p>{reported ? copy.send.reported : copy.send.held}</p>
      </>
    );
  if (watched.kind === "checking" || watched.kind === "waiting")
    return (
      <>
        <h1>{copy.send.title}</h1>
        <p role="status">{copy.send.sent}</p>
        <p>{copy.send.refused.walk_not_done}</p>
        {watched.kind === "checking" ? (
          <p aria-live="polite">{copy.send.step(watched.state)}</p>
        ) : (
          <p role="alert">{copy.send.refused.offline}</p>
        )}
      </>
    );
  const said = watched.kind === "failed" ? watched.message : copy.send.lost;
  return (
    <>
      <h1>{copy.send.title}</h1>
      {said === null ? null : <p role="alert">{said}</p>}
      <RecordWalk />
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

const NotNow = () => (
  <>
    <a className="button" href={ROUTES.home}>
      {copy.leaves.notNow}
    </a>
    <p>{copy.leaves.later}</p>
  </>
);

const savedMinutes = (take: Take): number | null =>
  take.durationMs !== null && take.durationMs > 0 ? Math.ceil(take.durationMs / 60_000) : null;

const SendWalk = ({ take, send, clock, status }: { take: Take; send: Sender; clock: Clock; status: WalkStatus }) => {
  const { takes } = useDeps();
  const [sending, setSending] = useState<Sending>({ kind: "ready" });
  const forget = useCallback(() => {
    void takes()
      .then((store) => store.remove(take.id))
      .catch(() => undefined);
  }, [takes, take.id]);
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSending({ kind: "sending", progress: { sentBytes: 0, totalBytes: take.bytes } });
    const result = await send(take, (progress) => setSending({ kind: "sending", progress })).catch(
      (): SendResult => ({ code: "server_error" }),
    );
    running.current = false;
    setSending(result.code === undefined ? { kind: "sent", walkId: result.walkId } : { kind: "refused", code: result.code });
  }, [take, send]);

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
    <button className="button primary" type="button" onClick={() => void start()}>
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
        <NotNow />
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
      <Checking walkId={sending.walkId} opens={take.partOf?.walkId ?? sending.walkId} status={status} clock={clock} forget={forget} />
    );
  return (
    <>
      <h1>{copy.send.title}</h1>
      <p role="alert">{copy.send.refused[sending.code]}</p>
      {waiting && minutes !== null ? <p>{copy.send.savedMinutes(minutes)}</p> : null}
      <Saved take={take} />
      {sendButton}
      <NotNow />
    </>
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
      {take === null ? (
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
      ) : null}
    </main>
  );
};
