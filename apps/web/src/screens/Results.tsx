import { isCorner, SIDES, type ViewPreference } from "@emberwalk/shared";
import { useEffect, useState } from "react";
import { copy, draft } from "../copy.ts";
import { isTenantWalk } from "../walk-claim.ts";
import { useDeps } from "../deps.ts";
import { findingWords, reportWords } from "../draft-words.ts";
import { isRechecked } from "../finding-marks.ts";
import type { FindingStatus } from "../finding-marks.ts";
import { feetSaid } from "../distance.ts";
import { bandsOf, crossesFirstBand, dayOf, drawnOrder, firstOf, instructionOf, overAYearOld, partsToWalk, verdictOf, withoutRemoved } from "../results.ts";
import type { CornerGap, ResultFinding, ShownGap, Verdict, WalkResults } from "../results.ts";
import { findingFor, fixFor, mapFor, recheckFor, recordPartFor, reportFor, ROUTES } from "../router.ts";
import { JUDGE, judgeWords, TRUTH_SAMPLE_ID } from "../judge.ts";
import { heldSample } from "../samples.ts";
import { useView, ViewSwitch } from "./Detail.tsx";
import { numbering, PlacedMap } from "./HouseMap.tsx";
import { Photo } from "./Photo.tsx";
import { StatusLine } from "./Status.tsx";

type Shown = {
  view: ViewPreference;
  resultsId: string;
  statusOf: (findingId: string) => FindingStatus;
  numbers: ReadonlyMap<string, number>;
  recheckOf: ((findingId: string) => string) | null;
};

const Row = ({ finding, shown, listed }: { finding: ResultFinding; shown: Shown; listed: boolean }) => (
  <li className="finding" data-finding={finding.id}>
    {shown.numbers.has(finding.id) ? (
      <b className="number" aria-hidden="true">
        {shown.numbers.get(finding.id)}
      </b>
    ) : null}
    <Photo proof={finding.proof} />
    <p data-part="sentence">
      <a href={findingFor(shown.resultsId, finding.id)}>{instructionOf(finding)}</a>
    </p>
    {finding.advice ? <p className="advice" data-part="advice">{findingWords.advice}</p> : null}
    {listed ? <p data-part="distance">{copy.results.distance(feetSaid(finding.distanceFeet))}</p> : null}
    <p className={`label ${finding.label}`} data-part="label">
      {copy.results.label[finding.label]}
    </p>
    <StatusLine status={shown.statusOf(finding.id)} recheck={shown.recheckOf?.(finding.id)} />
    {shown.view === "detailed" ? (
      <ul className="citations" data-part="citations">
        {finding.sources.map((s) => (
          <li key={s.citation}>{s.citation}</li>
        ))}
      </ul>
    ) : null}
  </li>
);

const Rows = ({ findings, shown, listed = false }: { findings: ResultFinding[]; shown: Shown; listed?: boolean }) => (
  <ul className="findings">
    {findings.map((f) => (
      <Row key={f.id} finding={f} shown={shown} listed={listed} />
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

const heading = (v: Verdict, synthetic: boolean): string => {
  if (v.kind === "incomplete") return synthetic ? copy.sample.partial : copy.results.incomplete;
  if (v.kind === "so_far") return copy.results.soFar;
  return v.kind === "fix" ? copy.results.fixFirst(v.first.length) : copy.results.ready;
};

const isCornerGap = (gap: ShownGap): gap is CornerGap => isCorner(gap.side);

const gapLine = (gap: ShownGap): string => (isCornerGap(gap) ? draft.corners.gap[gap.kind](gap.side) : copy.results.gap(gap));

const gapHint = (gap: ShownGap): string => (isCornerGap(gap) ? draft.corners.hint(gap.side) : copy.results.hint[gap.hint](gap.side));

const Body = ({ verdict, results, shown: plain, first }: { verdict: Verdict; results: WalkResults; shown: Shown; first: ResultFinding[] }) => {
  const order = verdict.kind === "ready" ? [] : drawnOrder(first, results.findings);
  const pins = results.pins ?? [];
  const shown: Shown = { ...plain, numbers: numbering(order, pins) };
  const house = plain.view === "detailed" ? <PlacedMap findings={order} pins={pins} resultsId={results.id} /> : null;
  if (verdict.kind === "incomplete")
    return (
      <>
        {results.synthetic ? <p>{copy.sample.partialLine}</p> : null}
        {results.findings.length > 0 ? (
          <section className="so-far">
            <h2>{copy.results.soFar}</h2>
            {first.length > 0 ? (
              <>
                <h3>{copy.results.fixFirst(first.length)}</h3>
                <Rows findings={first} shown={shown} />
              </>
            ) : null}
            {house}
            <Bands findings={results.findings.filter((f) => !first.includes(f))} shown={shown} sub />
          </section>
        ) : null}
        {results.synthetic ? null : (
          <section className="still-to-walk panel">
            <ul className="lines">
              {verdict.gaps.map((gap) => (
                <li key={`${gap.side}-${gap.kind}`}>
                  <span>{gapLine(gap)}</span>
                  <p className="hint">{gapHint(gap)}</p>
                </li>
              ))}
            </ul>
            {partsToWalk(verdict.gaps).map((part, i) => (
              <a key={part} className={i === 0 ? "button primary" : "button"} href={recordPartFor(results.id, part)}>
                {isCorner(part) ? draft.corners.panCorner(part) : copy.results.walkSide(part)}
              </a>
            ))}
          </section>
        )}
      </>
    );
  if (verdict.kind === "fix")
    return (
      <>
        <p className="lead">{copy.results.lead}</p>
        <p className="count">{copy.results.inside(verdict.first.filter((f) => f.band === "zone_0" && !crossesFirstBand(f)).length)}</p>
        {verdict.first.some(crossesFirstBand) ? <p className="count">{copy.results.close(verdict.first.filter(crossesFirstBand).length)}</p> : null}
        <p className="count">{copy.results.out(verdict.first.filter((f) => f.band === "zone_1").length)}</p>
        {house}
        <Rows findings={verdict.first} shown={shown} listed />
        <Bands findings={results.findings.filter((f) => !verdict.first.includes(f))} shown={shown} sub={false} />
      </>
    );
  if (verdict.kind === "so_far")
    return (
      <>
        {order.length > 0 ? house : null}
        <Bands findings={results.findings} shown={shown} sub={false} />
      </>
    );
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
  const [view, choose] = useView();

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
  const rechecks = deps.limits.recheckOn;
  const recorded = deps.sampleRechecks[results.id];
  const recheckOf = !rechecks || (heldSample(results.id) && recorded === undefined) ? null : (findingId: string) => recheckFor(results.id, findingId);
  const shown: Shown = { view, resultsId: results.id, statusOf, numbers: new Map(), recheckOf };
  const notChecked = results.notChecked ?? [];
  const unplaced = [...SIDES, null]
    .map((side) => ({ side, concepts: (results.unplaced ?? []).filter((u) => u.side === side).map((u) => u.concept) }))
    .filter((line) => line.concepts.length > 0);

  return (
    <main className="screen results" data-verdict={verdict.kind} data-view={view}>
      <ViewSwitch view={view} choose={choose} />
      <h1>{heading(verdict, results.synthetic)}</h1>
      <p>{copy.results.walked(dayOf(results.walkedOn))}</p>
      {overAYearOld(results.walkedOn, deps.clock.now()) ? <p>{copy.results.old}</p> : null}
      {notChecked.length + unplaced.length > 0 ? (
        <ul className="lines not-checked">
          {notChecked.map((concept) => (
            <li key={concept}>{copy.results.notChecked(concept)}</li>
          ))}
          {unplaced.map(({ side, concepts }) => (
            <li key={`unplaced-${side}`}>{copy.results.unplaced(side, concepts)}</li>
          ))}
        </ul>
      ) : null}
      {JUDGE && results.id === TRUTH_SAMPLE_ID ? <p data-part="truth">{judgeWords.truth}</p> : null}
      <Body verdict={verdict} results={listed} shown={shown} first={firstOf(verdict, listed.findings, (f) => isRechecked(statusOf(f.id)))} />
      {listed.findings.length > 0 && !isTenantWalk(results.id) ? (
        <a className={verdict.kind === "fix" ? "button primary" : "button"} data-part="get-it-fixed" href={fixFor(results.id)}>
          {draft.fixed.title}
        </a>
      ) : null}
      {view === "simple" && listed.findings.length > 0 ? (
        <a className="button" data-part="map" href={mapFor(results.id)}>
          {copy.map.button}
        </a>
      ) : null}
      {deps.report !== undefined && !heldSample(results.id) ? (
        <a className="button" data-part="report" href={reportFor(results.id)}>
          {reportWords.entry}
        </a>
      ) : null}
    </main>
  );
};
