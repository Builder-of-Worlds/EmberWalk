import { useEffect, useState } from "react";
import { copy, walkDate } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { resultsFor, ROUTES, sendFor, WALK_START } from "../router.ts";
import { SAMPLES } from "../samples.ts";
import type { Take } from "../take-store.ts";

const YourWalks = ({ takes }: { takes: Take[] }) => (
  <section className="walks" aria-labelledby="your-walks">
    <h2 id="your-walks">{copy.home.walks}</h2>
    <ul>
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

  useEffect(() => {
    let live = true;
    void deps
      .takes()
      .then((store) => store.all())
      .then((all) => {
        if (live) setTakes(all.filter((take) => take.bytes > 0));
      });
    return () => {
      live = false;
    };
  }, [deps]);

  return (
    <main className="screen">
      <h1>{copy.home.title}</h1>
      <a className="button primary" href={deps.prefs.introSeen() ? WALK_START : ROUTES.how}>
        {copy.home.walk}
      </a>
      {SAMPLES.map((sample) => (
        <a key={sample.id} className="button" href={resultsFor(sample.id)}>
          {copy.home.sample}
        </a>
      ))}
      {takes.length > 0 ? <YourWalks takes={takes} /> : null}
    </main>
  );
};
