import { useEffect, useState } from "react";
import { copy, walkDate } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { JUDGE } from "../judge.ts";
import { checkingFor, resultsFor, ROUTES, sendFor, WALK_START } from "../router.ts";
import { SAMPLES } from "../samples.ts";
import type { SentWalk } from "../sent-walks.ts";
import type { Take } from "../take-store.ts";
import { BrandMark } from "./BrandMark.tsx";

const YourWalks = ({ checking, takes }: { checking: SentWalk[]; takes: Take[] }) => (
  <section className="walks" aria-labelledby="your-walks">
    <h2 id="your-walks">{copy.home.walks}</h2>
    <ul>
      {checking.map((walk) => (
        <li key={walk.walkId} className="checking">
          <span id={`checking-${walk.walkId}`}>{walkDate(walk.createdAt)}</span>
          <p>{copy.send.refused.walk_not_done}</p>
          <a className="button" href={checkingFor(walk.walkId)} aria-describedby={`checking-${walk.walkId}`}>
            {copy.home.progress}
          </a>
        </li>
      ))}
      {takes.map((take) => (
        <li key={take.id}>
          <span id={`walk-${take.id}`}>{walkDate(take.createdAt)}</span>
          <a className="button" href={sendFor(take.id)} aria-describedby={`walk-${take.id}`}>
            {copy.home.send}
          </a>
        </li>
      ))}
    </ul>
  </section>
);

export const Home = () => {
  const deps = useDeps();
  const [takes, setTakes] = useState<Take[]>([]);
  const [checking] = useState(() => deps.sentWalks.all());

  useEffect(() => {
    let live = true;
    void deps
      .takes()
      .then((store) => store.all())
      .then((all) => {
        if (live) setTakes(all.filter((take) => take.bytes > 0 && !checking.some((walk) => walk.walkId === take.upload?.walkId)));
      });
    return () => {
      live = false;
    };
  }, [deps, checking]);

  return (
    <main className="screen">
      <BrandMark />
      <h1>{copy.home.title}</h1>
      <a className="button primary" href={JUDGE || deps.prefs.introSeen() ? WALK_START : ROUTES.how}>
        {copy.home.walk}
      </a>
      {SAMPLES.map((sample) => (
        <a key={sample.id} className="button" href={resultsFor(sample.id)}>
          {copy.home.sample}
        </a>
      ))}
      <a className="button" href={ROUTES.history}>
        {copy.history.title}
      </a>
      {checking.length + takes.length > 0 ? <YourWalks checking={checking} takes={takes} /> : null}
    </main>
  );
};
