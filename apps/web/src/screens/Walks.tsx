import { copy, shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { dashboardWords as d, reportWords } from "../draft-words.ts";
import { JUDGE } from "../judge.ts";
import { reportFor, resultsFor, ROUTES, WALK_START } from "../router.ts";
import { isSample, SAMPLES } from "../samples.ts";
import { useLoad } from "../use-load.ts";
import { Failed, Loading } from "./Failed.tsx";

export const Walks = () => {
  const deps = useDeps();
  const { loaded, retry } = useLoad(() => deps.fixed.history(), "history");
  const walks = loaded.state === "ready" ? [...loaded.value.walks].filter((walk) => JUDGE || !isSample(walk.walkId)).sort((a, b) => (a.walkedOn < b.walkedOn ? 1 : -1)) : [];
  return (
    <main className="screen walks-screen">
      <h1>{copy.home.walks}</h1>
      {loaded.state === "loading" ? <Loading /> : null}
      {loaded.state === "failed" ? <Failed code={loaded.code} retry={retry} /> : null}
      {loaded.state === "ready" && walks.length === 0 ? (
        <>
          <p>{d.noWalk}</p>
          <a className="button primary" href={deps.prefs.introSeen() ? WALK_START : ROUTES.how}>
            {copy.home.walk}
          </a>
        </>
      ) : null}
      {walks.length === 0 ? null : (
      <ul className="walk-list">
        {walks.map((walk) => (
          <li key={walk.walkId} data-walk={walk.walkId}>
            <h2>{shortDay(walk.walkedOn)}</h2>
            <a className="button primary" href={resultsFor(walk.walkId)}>
              {d.results}
            </a>
            <a className="button" href={reportFor(walk.walkId)}>
              {reportWords.title}
            </a>
          </li>
        ))}
      </ul>
      )}
      {SAMPLES.map((sample) => (
        <a key={sample.id} className="button" href={resultsFor(sample.id)}>
          {copy.home.sample}
        </a>
      ))}
    </main>
  );
};
