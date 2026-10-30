import { conceptLabel, copy, draft, shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import type { HistoryMark, HistoryWalk } from "../fixed-api.ts";
import { localDay } from "../mark-sync.ts";
import { dayOf } from "../results.ts";
import { ROUTES } from "../router.ts";
import { useLoad } from "../use-load.ts";
import { Failed, Loading } from "./Failed.tsx";

const markDay = (mark: HistoryMark): string => mark.doneOn ?? localDay(Date.parse(mark.markedAt));

const newestFirst = (walks: HistoryWalk[]): HistoryWalk[] => [...walks].sort((a, b) => (a.walkedOn < b.walkedOn ? 1 : a.walkedOn > b.walkedOn ? -1 : 0));

const Walk = ({ walk }: { walk: HistoryWalk }) => (
  <section className="record-walk" data-walk={walk.walkId}>
    <h2>
      <time dateTime={walk.walkedOn}>{copy.results.walked(dayOf(walk.walkedOn))}</time>
    </h2>
    {walk.marks.length === 0 ? (
      <p>{draft.history.noMarks}</p>
    ) : (
      <ul className="findings marks">
        {walk.marks.map((mark) => (
          <li key={mark.id} className="finding" data-mark={mark.id}>
            <p className="who">{conceptLabel(mark.concept)}</p>
            <p data-part="mark">{draft.history.mark(copy.status.kind[mark.status], shortDay(markDay(mark)))}</p>
            {mark.note === null || mark.note === "" ? null : <q>{mark.note}</q>}
          </li>
        ))}
      </ul>
    )}
  </section>
);

export const History = () => {
  const deps = useDeps();
  const { loaded, retry } = useLoad(() => deps.fixed.history(), "history");
  return (
    <main className="screen history">
      <h1>{copy.history.title}</h1>
      {loaded.state === "loading" ? <Loading /> : null}
      {loaded.state === "ready" ? <p>{draft.history.intro}</p> : null}
      {loaded.state === "failed" ? <Failed code={loaded.code} retry={retry} /> : null}
      {loaded.state === "ready" && loaded.value.walks.length === 0 ? <p>{draft.history.empty}</p> : null}
      {loaded.state === "ready" ? newestFirst(loaded.value.walks).map((walk) => <Walk key={walk.walkId} walk={walk} />) : null}
      <a className="button" href={ROUTES.home}>
        {copy.app.name}
      </a>
    </main>
  );
};
