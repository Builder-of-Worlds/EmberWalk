import type { ViewPreference } from "@emberwalk/shared";
import { useEffect, useState } from "react";
import { copy } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { isRechecked } from "../finding-marks.ts";
import type { FindingStatus } from "../finding-marks.ts";
import { bandsOf, dayOf, overAYearOld, sidesToWalk, verdictOf, withoutRemoved } from "../results.ts";
import type { ResultFinding, Verdict, WalkResults } from "../results.ts";
import { findingFor, recordPartFor, ROUTES, WALK_START } from "../router.ts";
import { Photo } from "./Photo.tsx";
import { StatusLine } from "./Status.tsx";

const VIEWS: ViewPreference[] = ["simple", "detailed"];

type Shown = { view: ViewPreference; resultsId: string; statusOf: (findingId: string) => FindingStatus };

const Row = ({ finding, shown }: { finding: ResultFinding; shown: Shown }) => (
  <li className="finding" data-finding={finding.id}>
    <Photo proof={finding.proof} />
    <p data-part="sentence">
      <a href={findingFor(shown.resultsId, finding.id)}>{finding.instruction}</a>
    </p>
    <p className={`label ${finding.label}`} data-part="label">
      {copy.results.label[finding.label]}
    </p>
    <StatusLine status={shown.statusOf(finding.id)} />
    {shown.view === "detailed" ? (
      <ul className="citations" data-part="citations">
        {finding.sources.map((s) => (
          <li key={s.citation}>{s.citation}</li>
        ))}
      </ul>
    ) : null}
  </li>
);

const Rows = ({ findings, shown }: { findings: ResultFinding[]; shown: Shown }) => (
  <ul className="findings">
    {findings.map((f) => (
      <Row key={f.id} finding={f} shown={shown} />
    ))}
  </ul>
);

const Bands = ({ findings, shown, sub }: { findings: ResultFinding[]; shown: Shown; sub: boolean }) => (
  <>
    {bandsOf(findings).map(({ band, findings: inBand }) => (
      <section key={band} className="band" data-band={band}>
        {sub ? <h3>{copy.results.bands[band]}</h3> : <h2>{copy.results.bands[band]}</h2>}
        <Rows findings={inBand} shown={shown} />
      </section>
    ))}
  </>
);

const heading = (v: Verdict): string => {
  if (v.kind === "incomplete") return copy.results.incomplete;
  if (v.kind === "so_far") return copy.results.soFar;
  return v.kind === "fix" ? copy.results.fixFirst(v.first.length) : copy.results.ready;
};

const Body = ({ verdict, results, shown, walkAgain }: { verdict: Verdict; results: WalkResults; shown: Shown; walkAgain: string }) => {
  if (verdict.kind === "incomplete")
    return (
      <>
        <ul className="lines">
          {verdict.gaps.map((gap) => (
            <li key={`${gap.side}-${gap.kind}`}>
              <span>{copy.results.gap(gap)}</span>
              {results.synthetic ? null : <p className="hint">{copy.results.hint[gap.hint](gap.side)}</p>}
            </li>
          ))}
        </ul>
        {results.synthetic ? null : sidesToWalk(verdict.gaps).length === 0 ? (
          <a className="button primary" href={walkAgain}>
            {copy.results.walkAgain}
          </a>
        ) : (
          sidesToWalk(verdict.gaps).map((side) => (
            <a key={side} className="button primary" href={recordPartFor(results.id, side)}>
              {copy.results.walkSide(side)}
            </a>
          ))
        )}
        {results.findings.length > 0 ? (
          <section className="so-far">
            <h2>{copy.results.soFar}</h2>
            <Bands findings={results.findings} shown={shown} sub />
          </section>
        ) : null}
      </>
    );
  if (verdict.kind === "fix")
    return (
      <>
        <Rows findings={verdict.first} shown={shown} />
        <Bands findings={results.findings} shown={shown} sub={false} />
      </>
    );
  if (verdict.kind === "so_far") return <Bands findings={results.findings} shown={shown} sub={false} />;
  return (
    <>
      <p className="lead green">{copy.results.allClear}</p>
      <p>{copy.results.insurance}</p>
      <Bands findings={results.findings} shown={shown} sub={false} />
    </>
  );
};

export const Results = ({ resultsId }: { resultsId: string | null }) => {
  const deps = useDeps();
  const [results, setResults] = useState<WalkResults | null>(null);
  const [view, setView] = useState<ViewPreference>(() => deps.prefs.view());

  useEffect(() => {
    let live = true;
    void (resultsId === null ? Promise.resolve(null) : deps.results(resultsId)).then((found) => {
      if (!live) return;
      if (found === null) window.location.replace(ROUTES.home);
      else setResults(found);
    });
    return () => {
      live = false;
    };
  }, [deps, resultsId]);

  if (results === null) return null;
  const listed = withoutRemoved(results, deps.marks.removed(results.id));
  const statusOf = (findingId: string) => deps.marks.statusOf(results.id, findingId);
  const verdict = verdictOf(listed, (f) => isRechecked(statusOf(f.id)));
  const shown: Shown = { view, resultsId: results.id, statusOf };
  const notChecked = results.notChecked ?? [];
  const choose = (chosen: ViewPreference) => {
    deps.prefs.setView(chosen);
    setView(chosen);
  };

  return (
    <main className="screen results" data-verdict={verdict.kind} data-view={view}>
      <div className="views" role="group" aria-label={copy.results.views}>
        {VIEWS.map((v) => (
          <button key={v} className="button toggle" type="button" aria-pressed={view === v} onClick={() => choose(v)}>
            {copy.results[v]}
          </button>
        ))}
      </div>
      <h1>{heading(verdict)}</h1>
      <p>{copy.results.walked(dayOf(results.walkedOn))}</p>
      {overAYearOld(results.walkedOn, deps.clock.now()) ? <p>{copy.results.old}</p> : null}
      {notChecked.length > 0 ? (
        <ul className="lines not-checked">
          {notChecked.map((concept) => (
            <li key={concept}>{copy.results.notChecked(concept)}</li>
          ))}
        </ul>
      ) : null}
      <Body verdict={verdict} results={listed} shown={shown} walkAgain={deps.prefs.introSeen() ? WALK_START : ROUTES.how} />
    </main>
  );
};
