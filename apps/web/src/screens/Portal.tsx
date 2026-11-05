import { useEffect, useRef, useState } from "react";
import { playHls } from "../hls-play.ts";
import heroEast from "../../../../fixtures/synthetic/hero-look/synthetic-hero-east.jpg";
import heroFront from "../../../../fixtures/synthetic/hero-look/synthetic-hero-front.jpg";
import heroNorth from "../../../../fixtures/synthetic/hero-look/synthetic-hero-north.jpg";
import heroWest from "../../../../fixtures/synthetic/hero-look/synthetic-hero-west.jpg";
import { JUDGE_MEDIA, judgeWords as words } from "../judge.ts";
import { fixFor, reportFor, resultsFor, ROUTES, WALK_START } from "../router.ts";
import { SAMPLES } from "../samples.ts";

const SCENES = [heroFront, heroWest, heroNorth, heroEast];

const EMBERS = 16;

const FILM_HASH = "#film";

const media = (file: string): string => new URL(file, document.baseURI).href;

const Film = ({ close }: { close: () => void }) => {
  const video = useRef<HTMLVideoElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const player = video.current;
    if (player === null) return;
    let stop = () => undefined as void;
    let open = true;
    void playHls(player, media(JUDGE_MEDIA.video), 0, () => setFailed(true)).then((stopping) => {
      if (!open) return stopping();
      stop = stopping;
      void player.play().catch(() => player.focus());
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    button.current?.focus();
    return () => {
      open = false;
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, []);
  return (
    <div className="film" role="dialog" aria-modal="true" aria-label={words.video}>
      <video ref={video} controls autoPlay playsInline poster={media(JUDGE_MEDIA.poster)} />
      {failed ? <p role="status">{words.filmFailed}</p> : null}
      <button ref={button} className="button" type="button" onClick={close}>
        {words.close}
      </button>
    </div>
  );
};

export const Portal = () => {
  const [film, setFilm] = useState(() => window.location.hash === FILM_HASH);
  const closeFilm = () => {
    if (window.location.hash === FILM_HASH) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${ROUTES.home}`);
    setFilm(false);
  };
  const id = SAMPLES[0]!.id;
  const tiles: [string, string][] = [
    [words.screens.how, ROUTES.how],
    [words.screens.results, resultsFor(id)],
    [words.screens.fix, fixFor(id)],
    [words.screens.report, reportFor(id)],
    [words.screens.history, ROUTES.history],
    [words.screens.homes, ROUTES.homes],
    [words.screens.about, ROUTES.about],
  ];
  return (
    <main className="portal">
      <section className="portal-hero">
        <div className="scenes" aria-hidden="true">
          {SCENES.map((scene, i) => (
            <div key={scene} className="scene" style={{ backgroundImage: `url(${scene})`, animationDelay: `${i * 12}s` }} />
          ))}
          <div className="dusk" />
          {Array.from({ length: EMBERS }, (_, i) => (
            <span key={i} className="ember" style={{ left: `${(i * 61) % 100}%`, animationDelay: `${(i * 1.7) % 11}s`, animationDuration: `${9 + (i % 6)}s` }} />
          ))}
        </div>
        <div className="portal-top">
          <button className="button primary portal-film" type="button" onClick={() => setFilm(true)}>
            {words.video}
          </button>
          <div className="portal-name">
            <h1>{words.title}</h1>
            <p className="portal-lead">{words.lead}</p>
          </div>
        </div>
      </section>
      <section className="portal-walk">
        <p className="portal-label">{words.label}</p>
        <h2>{words.walkHeading}</h2>
        <p>{words.walkLine}</p>
        <a className="button primary" href={WALK_START}>
          {words.walkButton}
        </a>
        <a className="button" href={resultsFor(id)}>
          {words.resultsButton}
        </a>
      </section>
      <section className="portal-app">
        <h2>{words.appHeading}</h2>
        <p>{words.appLine}</p>
        <div className="portal-tiles">
          {tiles.map(([label, href]) => (
            <a key={href} className="button" href={href}>
              {label}
            </a>
          ))}
        </div>
      </section>
      {film ? <Film close={closeFilm} /> : null}
    </main>
  );
};
