import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { copy, draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { findingWords } from "../draft-words.ts";
import { feetSaid } from "../distance.ts";
import { isRechecked } from "../finding-marks.ts";
import { BANDS, bandsOf, drawnOrder, firstOf, instructionOf, verdictOf, withoutRemoved } from "../results.ts";
import type { Band } from "@emberwalk/shared";
import type { ResultFinding, WalkResults } from "../results.ts";
import { findingFor, resultsFor, ROUTES } from "../router.ts";
import { numbering, PlacedMap } from "./HouseMap.tsx";

const EASE_MS = 450;

const calm = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeDown = (event: MouseEvent<HTMLElement>) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#/finding']");
  if (link === null || calm()) return;
  event.preventDefault();
  const figure = event.currentTarget;
  const box = figure.getBoundingClientRect();
  const at = link.getBoundingClientRect();
  figure.style.transformOrigin = `${at.left + at.width / 2 - box.left}px ${at.top + at.height / 2 - box.top}px`;
  figure.style.transition = `transform ${EASE_MS}ms ease-in, opacity ${EASE_MS}ms ease-in`;
  figure.style.transform = "scale(2.4)";
  figure.style.opacity = "0.2";
  window.setTimeout(() => {
    window.location.hash = link.getAttribute("href") ?? ROUTES.home;
  }, EASE_MS);
};

const HouseView = ({ results, first }: { results: WalkResults; first: ResultFinding[] }) => {
  const pins = results.pins ?? [];
  const bands = bandsOf(results.findings);
  const order = drawnOrder(first, results.findings);
  const numbers = numbering(order, pins);
  const inRing = (band: Band) => bands.find((b) => b.band === band)?.findings ?? [];
  return (
    <>
      {first.length > 0 ? (
        <section className="band map-ring fix-first">
          <h2>{copy.results.fixFirst(first.length)}</h2>
          <p className="lead">{copy.results.lead}</p>
          <ul className="lines">
            {first.map((finding) => (
              <li key={finding.id}>
                <a className="marker-link" href={findingFor(results.id, finding.id)}>
                  {numbers.has(finding.id) ? `${numbers.get(finding.id)}. ` : ""}
                  {instructionOf(finding)}
                </a>
                {finding.advice ? <p className="advice" data-part="advice">{findingWords.advice}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {results.findings.length === 0 ? (
        <p>{draft.detail.mapEmpty}</p>
      ) : (
        <div onClick={easeDown}>
          <PlacedMap findings={order} pins={pins} resultsId={results.id} />
        </div>
      )}
      {BANDS.map((band) => (
        <section key={band} className="band map-ring" data-band={band}>
          <h2>
            {copy.results.bands[band]} ({inRing(band).length})
          </h2>
          <ul className="lines">
            {inRing(band).map((finding) => (
              <li key={finding.id}>
                <a className="marker-link" href={findingFor(results.id, finding.id)} data-finding={finding.id}>
                  {numbers.has(finding.id) ? `${numbers.get(finding.id)}. ` : ""}
                  {instructionOf(finding)}
                </a>
                {finding.advice ? <p className="advice" data-part="advice">{findingWords.advice}</p> : null}
                <p>{copy.results.distance(feetSaid(finding.distanceFeet))}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};

export const MapScreen = ({ mapId }: { mapId: string | null }) => {
  const deps = useDeps();
  const [results, setResults] = useState<WalkResults | null>(null);

  useEffect(() => {
    let live = true;
    void (mapId === null ? Promise.resolve(null) : deps.results(mapId)).then((found) => {
      if (!live) return;
      if (found === null) window.location.replace(ROUTES.home);
      else setResults(withoutRemoved(found, deps.marks.removed(found.id)));
    });
    return () => {
      live = false;
    };
  }, [deps, mapId]);

  if (results === null) return null;
  const cleared = (f: ResultFinding) => isRechecked(deps.marks.statusOf(results.id, f.id));
  const first = firstOf(verdictOf(results, cleared), results.findings, cleared);
  return (
    <main className="screen map-screen">
      <h1>{draft.detail.mapTitle}</h1>
      {results.synthetic ? <p>{copy.sample.label}</p> : null}
      <HouseView results={results} first={first} />
      <a className="button" href={resultsFor(results.id)}>
        {draft.detail.backToResults}
      </a>
    </main>
  );
};
