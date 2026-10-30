import { isCorner, type ViewPreference } from "@emberwalk/shared";
import { useEffect, useState } from "react";
import { copy, draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { draftWordsShown } from "../draft-words.ts";
import { isRechecked } from "../finding-marks.ts";
import type { FindingStatus } from "../finding-marks.ts";
import { feetSaid } from "../distance.ts";
import { bandsOf, dayOf, overAYearOld, partsToWalk, verdictOf, withoutRemoved } from "../results.ts";
import type { CornerGap, ResultFinding, ShownGap, Verdict, WalkResults } from "../results.ts";
import { findingFor, fixFor, recordPartFor, ROUTES } from "../router.ts";
import { useView, ViewSwitch } from "./Detail.tsx";
import { HouseMap, numbering } from "./HouseMap.tsx";
import { Photo } from "./Photo.tsx";
import { StatusLine } from "./Status.tsx";

type Shown = { view: ViewPreference; resultsId: string; statusOf: (findingId: string) => FindingStatus; numbers: ReadonlyMap<string, number> };

const Row = ({ finding, shown, listed }: { finding: ResultFinding; shown: Shown; listed: boolean }) => (
  <li className="finding" data-finding={finding.id}>
    {shown.numbers.has(finding.id) ? (
      <b className="number" aria-hidden="true">
        {shown.numbers.get(finding.id)}
      </b>
    ) : null}
    <Photo proof={finding.proof} />
    <p data-part="sentence">
      <a href={findingFor(shown.resultsId, finding.id)}>{finding.instruction}</a>
    </p>
    {listed ? <p data-part="distance">{copy.results.distance(feetSaid(finding.distanceFeet))}</p> : null}
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

const heading = (v: Verdict): string => {
  if (v.kind === "incomplete") return copy.results.incomplete;
  if (v.kind === "so_far") return copy.results.soFar;
  return v.kind === "fix" ? copy.results.fixFirst(v.first.length) : copy.results.ready;
};

const isCornerGap = (gap: ShownGap): gap is CornerGap => isCorner(gap.side);

const gapLine = (gap: ShownGap): string => (isCornerGap(gap) ? draft.corners.gap[gap.kind](gap.side) : copy.results.gap(gap));

const gapHint = (gap: ShownGap): string => (isCornerGap(gap) ? draft.corners.hint(gap.side) : copy.results.hint[gap.hint](gap.side));

const drawnOrder =(verdict: Verdict, results: WalkResults): ResultFinding[] => {
  if (verdict.kind === "ready") return [];
  const banded = bandsOf(results.findings).flatMap((b) => b.findings);
  return verdict.kind === "fix" ? [...verdict.first, ...banded.filter((f) => !verdict.first.includes(f))] : banded;
};

const Body = ({ verdict, results, shown: plain }: { verdict: Verdict; results: WalkResults; shown: Shown }) => {
  const order = drawnOrder(verdict, results);
  const pins = results.pins ?? [];
  const shown: Shown = { ...plain, numbers: numbering(order, pins) };
  const house = <HouseMap findings={order} pins={pins} resultsId={results.id} />;
  if (verdict.kind === "incomplete")
    return (
      <>
        <ul className="lines">
          {verdict.gaps.map((gap) => (
            <li key={`${gap.side}-${gap.kind}`}>
              <span>{gapLine(gap)}</span>
              {results.synthetic ? null : <p className="hint">{gapHint(gap)}</p>}
            </li>
          ))}
        </ul>
        {results.synthetic
          ? null
          : partsToWalk(verdict.gaps).map((part, i) => (
              <a key={part} className={i === 0 ? "button primary" : "button"} href={recordPartFor(results.id, part)}>
                {isCorner(part) ? draft.corners.panCorner(part) : copy.results.walkSide(part)}
              </a>
            ))}
        {results.findings.length > 0 ? (
          <section className="so-far">
            <h2>{copy.results.soFar}</h2>
            {house}
            <Bands findings={results.findings} shown={shown} sub />
          </section>
        ) : null}
      </>
    );
  if (verdict.kind === "fix")
    return (
      <>
        <p className="lead">{copy.results.lead}</p>
        <p className="count">{copy.results.inside(verdict.first.filter((f) => f.band === "zone_0").length)}</p>
        <p className="count">{copy.results.out(verdict.first.filter((f) => f.band === "zone_1").length)}</p>
        {house}
        <Rows findings={verdict.first} shown={shown} listed />
        <Bands findings={results.findings} shown={shown} sub={false} />
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
  const verdict = verdictOf(listed, (f) => isRechecked(statusOf(f.id)), draftWordsShown());
  const shown: Shown = { view, resultsId: results.id, statusOf, numbers: new Map() };
  const notChecked = results.notChecked ?? [];

  return (
    <main className="screen results" data-verdict={verdict.kind} data-view={view}>
      <ViewSwitch view={view} choose={choose} />
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
      {listed.findings.length > 0 && !results.synthetic ? (
        <a className={verdict.kind === "fix" ? "button primary" : "button"} data-part="get-it-fixed" href={fixFor(results.id)}>
          {draft.fixed.title}
        </a>
      ) : null}
      <Body verdict={verdict} results={listed} shown={shown} />
    </main>
  );
};
