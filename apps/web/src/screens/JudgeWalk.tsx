import { useEffect, useRef, useState } from "react";
import { playHls } from "../hls-play.ts";
import { JUDGE_MEDIA, judgeWords as words } from "../judge.ts";
import { checkingFor, resultsFor } from "../router.ts";
import { SAMPLES } from "../samples.ts";

const PHONE_SCREEN = "(orientation: portrait)";

// Seconds into the wide file: four 20 s pieces joined by 0.5 s fades, each ending on a 14 s pan.
const STOPS = [
  { side: "left", from: 6, to: 20 },
  { side: "back", from: 25.5, to: 39.5 },
  { side: "right", from: 45, to: 59 },
  { side: "front", from: 64.5, to: 78.5 },
] as const;

// The upright file has the same length with plain joins at 20, 40 and 60 s.
const PHONE_STOPS = [
  { side: "left", from: 6, to: 20 },
  { side: "back", from: 26, to: 40 },
  { side: "right", from: 46, to: 60 },
  { side: "front", from: 64.5, to: 78.5 },
] as const;

export const walkLine = (seconds: number, upright = false): string => {
  const stops = upright ? PHONE_STOPS : STOPS;
  const stop = stops.find((s) => seconds >= s.from && seconds < s.to);
  if (stop !== undefined) return words.panning(stop.side);
  const next = stops.find((s) => seconds < s.from);
  return next === undefined ? words.arriving : words.walking(next.side);
};

const media = (file: string): string => new URL(file, document.baseURI).href;

export const JudgeWalk = () => {
  const id = SAMPLES[0]!.id;
  const video = useRef<HTMLVideoElement>(null);
  const [line, setLine] = useState(() => walkLine(0));
  const [failed, setFailed] = useState(false);
  const upright = useRef(false);
  const toChecking = () => {
    window.location.hash = checkingFor(id);
  };
  useEffect(() => {
    const player = video.current;
    if (player === null) return;
    const screen = window.matchMedia?.(PHONE_SCREEN);
    let stop = () => undefined as void;
    let latest = 0;
    const start = async (file: string, at: number) => {
      const turn = (latest += 1);
      stop();
      upright.current = file === JUDGE_MEDIA.walkPhone;
      const refused = () => (file === JUDGE_MEDIA.walk ? setFailed(true) : void start(JUDGE_MEDIA.walk, at));
      const stopping = await playHls(player, media(file), at, refused);
      if (turn !== latest) return stopping();
      stop = stopping;
      void player.play().catch(() => undefined);
    };
    const chosen = () => (screen?.matches ? JUDGE_MEDIA.walkPhone : JUDGE_MEDIA.walk);
    const swap = () => void start(chosen(), player.currentTime);
    void start(chosen(), 0);
    screen?.addEventListener("change", swap);
    return () => {
      latest += 1;
      screen?.removeEventListener("change", swap);
      stop();
    };
  }, []);
  return (
    <main className="screen judge-walk">
      <p className="portal-label">{words.label}</p>
      <div className="walk-stage">
        <video
          ref={video}
          poster={media(JUDGE_MEDIA.walkPoster)}
          autoPlay
          muted
          playsInline
          controls
          onTimeUpdate={(event) => setLine(walkLine(event.currentTarget.currentTime, upright.current))}
          onEnded={toChecking}
        />
      </div>
      {failed ? <p role="status">{words.walkFailed}</p> : <p className="walk-line" aria-live="off">{line}</p>}
      <button className="button" type="button" onClick={() => void video.current?.requestFullscreen?.()}>
        {words.fullScreen}
      </button>
      <a className="button" href={resultsFor(id)}>
        {words.resultsButton}
      </a>
    </main>
  );
};
