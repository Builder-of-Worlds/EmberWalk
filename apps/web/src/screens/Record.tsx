import { useEffect, useRef, useState } from "react";
import { isCorner, type Side, type WalkPart } from "@emberwalk/shared";
import { copy, draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { draftWordsShown } from "../draft-words.ts";
import { askMotion, CORNERS, cornersFor, turnBetween } from "../motion.ts";
import type { Motion } from "../motion.ts";
import { isJurisdiction, locateRules } from "../location.ts";
import { cameraDevice, openCamera, startRecording } from "../recorder.ts";
import type { CameraRefusal, Recording } from "../recorder.ts";
import { ROUTES } from "../router.ts";
import type { Take } from "../take-store.ts";
import { HOUSE_CORNERS, HouseShape } from "./HouseShape.tsx";

type Phase =
  | { kind: "checking" }
  | { kind: "saved"; take: Take }
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "recording"; stream: MediaStream; motion: Motion }
  | { kind: "refused"; refusal: CameraRefusal };

const Preview = ({ stream }: { stream: MediaStream }) => {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current !== null) video.current.srcObject = stream;
  }, [stream]);
  return <video className="preview" ref={video} autoPlay muted playsInline />;
};

const TimeLeft = ({ recording }: { recording: Recording }) => {
  const { maxWalkMs } = useDeps();
  const [videoMs, setVideoMs] = useState(() => recording.videoMs());
  useEffect(() => {
    const id = setInterval(() => setVideoMs(recording.videoMs()), 500);
    return () => clearInterval(id);
  }, [recording]);
  return (
    <p className="time-left" role="timer">
      {copy.record.timeLeft(maxWalkMs - videoMs)}
    </p>
  );
};

const CORNER_AT = HOUSE_CORNERS;

type Panned = { done: number; panning: boolean };

const NOT_PANNED: Panned = { done: 0, panning: false };

const Outline = ({ motion, panned }: { motion: NonNullable<Motion>; panned: Panned }) => {
  const [corners, setCorners] = useState(0);
  useEffect(() => {
    let last: number | null = null;
    let net = 0;
    return motion.listen(({ headingDegrees }) => {
      if (last !== null) net += turnBetween(last, headingDegrees);
      last = headingDegrees;
      setCorners(cornersFor(net));
    });
  }, [motion]);
  return (
    <svg className="outline" viewBox="0 0 100 100" aria-hidden="true" data-corners={corners}>
      <HouseShape />
      {CORNER_AT.map(([x1, y1], i) => {
        const [x2, y2] = CORNER_AT[(i + 1) % CORNER_AT.length]!;
        const state = i < panned.done ? "panned" : i === panned.done && panned.panning ? "panning" : null;
        return state === null ? null : <line key={`${x1}-${y1}`} className={state} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {CORNER_AT.slice(0, CORNERS).map(([x, y], i) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="7" className={i < corners ? "done" : undefined} />
      ))}
    </svg>
  );
};

const Guide = ({ side, held, onNext }: { side: Side | null; held: boolean; onNext: () => void }) => (
  <>
    <p>{side === null ? draft.guided.back : draft.guided.now(side)}</p>
    {side === null ? null : (
      <button className="button" type="button" disabled={held} onClick={onNext}>
        {draft.guided.next}
      </button>
    )}
  </>
);

const Toggle = ({ label, on, disabled, onPress }: { label: string; on: boolean; disabled?: boolean; onPress: () => void }) => (
  <button className="button toggle" type="button" aria-pressed={on} disabled={disabled} onClick={onPress}>
    {label}
  </button>
);

const onePart = ({ side }: WalkPart): string => (isCorner(side) ? draft.corners.oneCorner(side) : copy.record.oneSide(side));

export const Record = ({ part = null }: { part?: WalkPart | null }) => {
  const deps = useDeps();
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const recording = useRef<Recording | null>(null);
  const awake = useRef<(() => void) | null>(null);
  const [sound, setSound] = useState(true);
  const [soundOff, setSoundOff] = useState(false);
  const [paused, setPaused] = useState(false);
  const [panned, setPanned] = useState<Panned & { left: number }>({ ...NOT_PANNED, left: 0 });
  const [rules, setRules] = useState<keyof typeof copy.record.location>("finding");
  const [draftWords] = useState(() => draftWordsShown());
  const [guide, setGuide] = useState<Side | null>(null);

  useEffect(() => {
    let live = true;
    void deps
      .takes()
      .then((takes) => takes.latest())
      .then((take) => {
        const beingChecked = take !== null && deps.sentWalks.all().some((walk) => walk.takeId === take.id);
        if (live) setPhase(take === null || beingChecked ? { kind: "idle" } : { kind: "saved", take });
      });
    return () => {
      live = false;
      recording.current?.stop();
      awake.current?.();
      awake.current = null;
    };
  }, [deps]);

  const start = async () => {
    setPhase({ kind: "opening" });
    setRules("finding");
    const located = locateRules(deps.locate).then((answer) => {
      setRules(isJurisdiction(answer) ? "found" : answer);
      if (!isJurisdiction(answer)) return null;
      deps.prefs.setJurisdiction(answer);
      return answer;
    });
    const [motion, camera] = await Promise.all([askMotion(deps.motion), openCamera(deps.media, sound)]);
    if ("refusal" in camera) return setPhase({ kind: "refused", refusal: camera.refusal });
    const takes = await deps.takes();
    const take = await takes.create(camera.mimeType, deps.clock.now(), {
      jurisdiction: deps.prefs.jurisdiction(),
      sound,
      device: cameraDevice(camera.stream),
      partOf: part,
    });
    void located.then((key) =>
      key === null || key === take.jurisdiction ? undefined : takes.setJurisdiction(take.id, key).catch(() => undefined),
    );
    const live = deps.prefs.agreedToSend() ? deps.live(takes, take.id, located) : null;
    const sink = {
      chunk: async (data: Blob) => {
        const kept = await takes.append(take.id, data);
        live?.chunk(data);
        return kept;
      },
      mark: (change: Parameters<typeof takes.mark>[1]) => takes.mark(take.id, change),
      finish: async (durationMs: number, endedBy: Parameters<typeof takes.finish>[2]) => {
        await live?.stop();
        return takes.finish(take.id, durationMs, endedBy);
      },
    };
    recording.current = startRecording(camera, sink, deps.clock, deps.maxWalkMs, motion, {
      light: deps.light(camera.stream),
      part: part?.side ?? null,
      guided: draftWords,
    });
    setGuide(recording.current.guide());
    setSoundOff(!sound);
    setPaused(false);
    setPanned({ ...NOT_PANNED, left: recording.current.pansLeft() });
    setPhase({ kind: "recording", stream: camera.stream, motion });
    awake.current = deps.awake.hold();
    await recording.current.done;
    recording.current = null;
    awake.current?.();
    awake.current = null;
    window.location.hash = ROUTES.send;
  };

  const pressPan = () => {
    const now = recording.current;
    if (now === null) return;
    const was = now.panning() !== null;
    now.pan();
    const panning = now.panning() !== null;
    setPanned((before) => ({ done: before.done + (was && !panning ? 1 : 0), panning, left: now.pansLeft() }));
  };

  const pressNext = () => {
    recording.current?.next();
    setGuide(recording.current?.guide() ?? null);
  };

  const togglePause = () => {
    if (paused) recording.current?.resume();
    else recording.current?.pause();
    setPaused(!paused);
  };

  const discard = async (take: Take) => {
    const uploadId = take.upload?.uploadId ?? null;
    if (uploadId !== null) await deps.abortUpload(uploadId).catch(() => undefined);
    await (await deps.takes()).remove(take.id);
    setPhase({ kind: "idle" });
  };

  return (
    <main className="screen">
      <h1>{copy.record.title}</h1>
      {phase.kind === "saved" ? (
        <>
          <p>{copy.record.saved}</p>
          <a className="button primary" href={ROUTES.send}>
            {copy.record.sendSaved}
          </a>
          <button className="button" type="button" onClick={() => void discard(phase.take)}>
            {copy.record.recordAgain}
          </button>
        </>
      ) : null}
      {phase.kind === "idle" ? (
        <>
          <p>{part === null ? copy.record.ready : onePart(part)}</p>
          <p>{copy.record.limit}</p>
          <Toggle label={copy.record.soundOff} on={!sound} onPress={() => setSound(!sound)} />
          <button className="button primary" type="button" onClick={() => void start()}>
            {copy.record.start}
          </button>
        </>
      ) : null}
      {phase.kind === "opening" ? <p role="status">{copy.record.opening}</p> : null}
      {phase.kind === "recording" ? (
        <>
          <Preview stream={phase.stream} />
          <p role="status">{copy.record.location[rules]}</p>
          {part !== null ? (
            <p>{onePart(part)}</p>
          ) : phase.motion === null ? (
            draftWords ? <Guide side={guide} held={paused || panned.panning} onNext={pressNext} /> : null
          ) : (
            <Outline motion={phase.motion} panned={panned} />
          )}
          {recording.current === null ? null : <TimeLeft recording={recording.current} />}
          <div className="controls">
            <Toggle label={copy.record.pause} on={paused} onPress={() => togglePause()} />
            <Toggle
              label={copy.record.soundOff}
              on={soundOff}
              disabled={soundOff}
              onPress={() => {
                recording.current?.soundOff();
                setSoundOff(true);
              }}
            />
            <button className="button" type="button" disabled={paused} onClick={() => recording.current?.propertyLine()}>
              {copy.record.propertyLine}
            </button>
            <Toggle
              label={copy.record.panYard}
              on={panned.panning}
              disabled={paused || (!panned.panning && panned.left === 0)}
              onPress={pressPan}
            />
          </div>
          <button className="button primary" type="button" onClick={() => recording.current?.stop()}>
            {copy.record.stop}
          </button>
        </>
      ) : null}
      {phase.kind === "refused" ? (
        <>
          <p role="alert">{copy.record[phase.refusal]}</p>
          <button className="button primary" type="button" onClick={() => void start()}>
            {copy.record.tryAgain}
          </button>
        </>
      ) : null}
      {phase.kind === "recording" ? null : (
        <a className="button" href={ROUTES.home}>
          {copy.record.back}
        </a>
      )}
    </main>
  );
};
