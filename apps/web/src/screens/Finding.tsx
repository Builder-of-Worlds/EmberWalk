import { useEffect, useState } from "react";
import { copy } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { STATUSES } from "../finding-marks.ts";
import type { StatusKind } from "../finding-marks.ts";
import type { ResultFinding, WalkResults } from "../results.ts";
import { resultsFor, ROUTES } from "../router.ts";
import type { FindingIds } from "../router.ts";
import { Photo } from "./Photo.tsx";
import { StatusLine } from "./Status.tsx";

type Found = { results: WalkResults; finding: ResultFinding };

export const Finding = ({ findingIds }: { findingIds: FindingIds | null }) => {
  const deps = useDeps();
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    let live = true;
    void (findingIds === null ? Promise.resolve(null) : deps.results(findingIds.resultsId)).then((results) => {
      if (!live) return;
      const finding = results?.findings.find((f) => f.id === findingIds?.findingId);
      if (results && finding) setFound({ results, finding });
      else window.location.replace(results ? resultsFor(results.id) : ROUTES.home);
    });
    return () => {
      live = false;
    };
  }, [deps, findingIds]);

  return found === null ? null : <OneFinding results={found.results} finding={found.finding} />;
};

const StatusPicker = ({ results, finding }: Found) => {
  const deps = useDeps();
  const [status, setStatus] = useState(() => deps.marks.statusOf(results.id, finding.id));
  const [note, setNote] = useState(status.note);
  const choose = (kind: StatusKind, text = "") => {
    deps.marks.setStatus(results.id, finding.id, kind, text);
    setStatus(deps.marks.statusOf(results.id, finding.id));
  };
  return (
    <section className="status-picker">
      <StatusLine status={status} />
      <div className="statuses">
        {STATUSES.map((kind) => (
          <button
            key={kind}
            className="button toggle"
            type="button"
            aria-pressed={status.kind === kind}
            onClick={() => choose(kind, kind === "fix_planned" ? note : "")}
          >
            {copy.status.kind[kind]}
          </button>
        ))}
      </div>
      {status.kind === "fix_planned" ? (
        <form
          className="note"
          onSubmit={(event) => {
            event.preventDefault();
            choose("fix_planned", note);
          }}
        >
          <label htmlFor="note">{copy.status.note}</label>
          <input id="note" type="text" maxLength={200} value={note} placeholder={copy.status.example} onChange={(e) => setNote(e.target.value)} />
          <button className="button" type="submit">
            {copy.status.save}
          </button>
          {status.note === "" ? null : <q>{status.note}</q>}
        </form>
      ) : null}
    </section>
  );
};

const OneFinding = ({ results, finding }: Found) => {
  const deps = useDeps();
  const [more, setMore] = useState(false);
  const [removed, setRemoved] = useState(() => deps.marks.removed(results.id).some((r) => r.findingId === finding.id));
  const remove = () => {
    deps.marks.remove(results.id, finding.id, deps.clock.now());
    setRemoved(true);
  };
  const undo = () => {
    deps.marks.restore(results.id, finding.id);
    setRemoved(false);
  };

  return (
    <main className="screen one-finding" data-finding={finding.id} data-removed={removed}>
      {results.synthetic ? <p className="sample">{copy.results.sample}</p> : null}
      <Photo proof={finding.proof} />
      <p className={`label ${finding.label}`}>{copy.results.label[finding.label]}</p>
      <p className="sentence">{finding.instruction}</p>
      {removed ? null : <StatusPicker results={results} finding={finding} />}
      {removed ? (
        <div className="removed">
          <p role="status">{copy.finding.removed}</p>
          <button className="button primary" type="button" onClick={undo}>
            {copy.finding.undo}
          </button>
        </div>
      ) : null}
      <button className="button" type="button" aria-expanded={more} aria-controls="more" onClick={() => setMore(!more)}>
        {copy.finding.more}
      </button>
      {more ? (
        <section id="more" className="more">
          <h2>{copy.finding.source}</h2>
          <ul className="sources">
            {finding.sources.map((s) => (
              <li key={s.citation}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.citation}
                </a>
                <q>{s.words}</q>
              </li>
            ))}
          </ul>
          {removed ? null : (
            <button className="button" type="button" onClick={remove}>
              {copy.finding.notRight}
            </button>
          )}
        </section>
      ) : null}
    </main>
  );
};
