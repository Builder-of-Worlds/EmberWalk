import { useEffect, useRef, useState } from "react";
import { useDeps } from "../deps.ts";
import { recheckWords } from "../draft-words.ts";
import type { RecheckResult } from "../finding-marks.ts";
import { useStill } from "../live-results.ts";
import type { ResultFinding, WalkResults } from "../results.ts";
import { resultsFor, ROUTES } from "../router.ts";
import { SignInAgain } from "./SignInAgain.tsx";
import type { FindingIds } from "../router.ts";
import { JUDGE, judgeWords } from "../judge.ts";
import { heldSample, type SampleRecheck } from "../samples.ts";
import { StatusLine } from "./Status.tsx";

type Found = { results: WalkResults; finding: ResultFinding };

type Phase =
  | { kind: "loading" }
  | { kind: "refused"; words: string }
  | { kind: "camera" }
  | { kind: "no_camera" }
  | { kind: "sending" }
  | { kind: "answered"; result: RecheckResult }
  | { kind: "failed"; words: string }
  | { kind: "sample"; recorded: SampleRecheck }
  | { kind: "sample_answered"; recorded: SampleRecheck };

const OLD_PHOTO_OPACITY = 0.35;

export const Recheck = ({ recheckIds }: { recheckIds: FindingIds | null }) => {
  const { limits } = useDeps();
  return limits.recheckOn && recheckIds !== null ? <RecheckScreen ids={recheckIds} /> : null;
};

const snap = (video: HTMLVideoElement): Promise<Blob | null> => {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.resolve(null);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.9));
};

const RecheckScreen = ({ ids }: { ids: FindingIds }) => {
  const deps = useDeps();
  const [found, setFound] = useState<Found | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void deps.results(ids.resultsId).then((results) => {
      if (!live) return;
      const finding = results?.findings.find((f) => f.id === ids.findingId);
      if (!results || !finding) return window.location.replace(results ? resultsFor(results.id) : ROUTES.home);
      setFound({ results, finding });
      const recorded = deps.sampleRechecks[results.id]?.[finding.id];
      if (heldSample(results.id) && recorded === undefined) return setPhase({ kind: "refused", words: recheckWords.sample });
      if (deps.marks.statusOf(results.id, finding.id).kind !== "done") return setPhase({ kind: "refused", words: recheckWords.notDone });
      setPhase(recorded === undefined ? { kind: "camera" } : { kind: "sample", recorded });
    });
    return () => {
      live = false;
    };
  }, [deps, ids]);

  return (
    <main className="screen recheck" data-phase={phase.kind}>
      <h1>{recheckWords.title}</h1>
      <SignInAgain />
      {found === null ? null : <Body found={found} phase={phase} setPhase={setPhase} />}
      <a className="button" data-part="back" href={resultsFor(ids.resultsId)}>
        {recheckWords.back}
      </a>
    </main>
  );
};

type SamplePhase = Extract<Phase, { kind: "sample" | "sample_answered" }>;

const SampleBody = ({ found, phase, setPhase }: { found: Found; phase: SamplePhase; setPhase: (phase: Phase) => void }) => {
  const deps = useDeps();
  const { results, finding } = found;
  const old = useStill(finding.proof.still);
  const { recorded } = phase;
  const use = () => {
    deps.marks.setRecheck(results.id, finding.id, { photo: recorded.photo, atMs: Date.parse(recorded.checkedOn), result: recorded.result });
    setPhase({ kind: "sample_answered", recorded });
  };
  return (
    <>
      <p className="lead">{recheckWords.sampleLead}</p>
      <div className="proof" data-part="sample-photos">
        <img className="preview" data-part="sample-after" src={recorded.photo} alt="" />
        {old === null ? null : <img src={old} alt="" data-part="old-photo" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: OLD_PHOTO_OPACITY, pointerEvents: "none" }} />}
      </div>
      {phase.kind === "sample" ? (
        <button className="button primary" type="button" onClick={use}>
          {recheckWords.useSample}
        </button>
      ) : (
        <>
          <p role="status">{recheckWords.answer[recorded.result]}</p>
          <p>{recheckWords.sampleNote}</p>
          <StatusLine status={deps.marks.statusOf(results.id, finding.id)} />
        </>
      )}
    </>
  );
};

const Body = ({ found, phase, setPhase }: { found: Found; phase: Phase; setPhase: (phase: Phase) => void }) => {
  const deps = useDeps();
  const { results, finding } = found;
  if (phase.kind === "refused") return <p role="status">{phase.words}</p>;
  if (phase.kind === "loading") return null;
  if (phase.kind === "no_camera") return <p role="status">{recheckWords.noCamera}</p>;
  if (phase.kind === "sample" || phase.kind === "sample_answered") return <SampleBody found={found} phase={phase} setPhase={setPhase} />;

  const judged = async (photo: Blob) => {
    const sent = await deps.rechecks.send(finding.id, photo);
    if (sent.recheck === undefined) return setPhase({ kind: "failed", words: recheckWords.failed[sent.code] });
    const { photo: key, createdAt, result } = sent.recheck;
    deps.marks.setRecheck(results.id, finding.id, { photo: key, atMs: Date.parse(createdAt), result });
    setPhase({ kind: "answered", result });
  };

  const send = async (video: HTMLVideoElement) => {
    setPhase({ kind: "sending" });
    const photo = await snap(video);
    if (photo === null) return setPhase({ kind: "failed", words: recheckWords.noPhoto });
    await judged(photo);
  };

  if (JUDGE)
    return (
      <>
        <p className="lead">{judgeWords.recheckLead}</p>
        {phase.kind === "answered" ? (
          <>
            <p data-part="sample-answer">{judgeWords.recheckAnswer}</p>
            <p role="status">{phase.result === "cleared" ? judgeWords.recheckCleared : recheckWords.answer[phase.result]}</p>
            <StatusLine status={deps.marks.statusOf(results.id, finding.id)} />
          </>
        ) : (
          <button className="button primary" type="button" onClick={() => void judged(new Blob())}>
            {judgeWords.recheckUse}
          </button>
        )}
      </>
    );

  return (
    <>
      <p className="lead">{recheckWords.lead}</p>
      <Camera still={finding.proof.still} busy={phase.kind === "sending"} send={send} refused={() => setPhase({ kind: "no_camera" })} />
      {phase.kind === "sending" ? <p role="status">{recheckWords.checking}</p> : null}
      {phase.kind === "failed" ? <p role="status">{phase.words}</p> : null}
      {phase.kind === "answered" ? (
        <>
          <p role="status">{recheckWords.answer[phase.result]}</p>
          <StatusLine status={deps.marks.statusOf(results.id, finding.id)} />
        </>
      ) : null}
    </>
  );
};

type CameraProps = { still: string; busy: boolean; send: (video: HTMLVideoElement) => Promise<void>; refused: () => void };

const Camera = ({ still, busy, send, refused }: CameraProps) => {
  const { media } = useDeps();
  const video = useRef<HTMLVideoElement>(null);
  const old = useStill(still);
  const [ready, setReady] = useState(false);
  const onRefused = useRef(refused);
  onRefused.current = refused;

  useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;
    const ask = media.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } }) ?? Promise.reject(new Error("no camera"));
    ask.then(
      (opened) => {
        stream = opened;
        if (!live) return opened.getTracks().forEach((track) => track.stop());
        if (video.current !== null) video.current.srcObject = opened;
        setReady(true);
      },
      () => live && onRefused.current(),
    );
    return () => {
      live = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [media]);

  return (
    <>
      <div className="proof" data-part="camera">
        <video className="preview" ref={video} autoPlay muted playsInline />
        {old === null ? null : (
          <img
            src={old}
            alt=""
            data-part="old-photo"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: OLD_PHOTO_OPACITY, pointerEvents: "none" }}
          />
        )}
      </div>
      {ready ? (
        <button className="button primary" type="button" disabled={busy} onClick={() => video.current && void send(video.current)}>
          {recheckWords.take}
        </button>
      ) : null}
    </>
  );
};
