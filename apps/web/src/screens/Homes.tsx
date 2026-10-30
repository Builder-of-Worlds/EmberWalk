import { useEffect, useState } from "react";
import { draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import type { Home } from "../portfolio-api.ts";
import { resultsFor, ROUTES } from "../router.ts";

const status = (home: Home): string => {
  if (home.walk === null) return draft.portfolio.notWalked;
  return home.walk.ready ? draft.portfolio.ready : draft.portfolio.needsFixes;
};

export const Homes = () => {
  const { portfolio } = useDeps();
  const [homes, setHomes] = useState<Home[] | null>(null);

  useEffect(() => {
    let live = true;
    void portfolio.homes().then((answer) => {
      if (live) setHomes(answer.code === undefined ? answer.value : []);
    });
    return () => {
      live = false;
    };
  }, [portfolio]);

  return (
    <main className="screen homes">
      <h1>{draft.portfolio.title}</h1>
      <ul className="lines">
        {(homes ?? []).map((home) => (
          <li key={home.id} data-home={home.id}>
            <b>{home.label}</b>
            <p>{status(home)}</p>
            {home.walk === null ? null : (
              <a className="button" href={resultsFor(home.walk.id)}>
                {draft.portfolio.seeResults}
              </a>
            )}
          </li>
        ))}
      </ul>
      <a className="button" href={ROUTES.home}>
        {draft.portfolio.back}
      </a>
    </main>
  );
};
