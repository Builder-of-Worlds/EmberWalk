import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { copy, draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { feetSaid } from "../distance.ts";
import { BANDS, bandsOf, withoutRemoved } from "../results.ts";
import type { Band } from "@emberwalk/shared";
import type { WalkResults } from "../results.ts";
import { findingFor, resultsFor, ROUTES } from "../router.ts";
import { HouseMap, numbering } from "./HouseMap.tsx";

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

const HouseView = ({ results }: { results: WalkResults }) => {
  const pins = results.pins ?? [];
  const bands = bandsOf(results.findings);
  const numbers = numbering(results.findings, pins);
  const inRing = (band: Band) => bands.find((b) => b.band === band)?.findings ?? [];
  return (
    <>
      <div onClick={easeDown}>
        <HouseMap findings={results.findings} pins={pins} resultsId={results.id} />
      </div>
      {results.findings.length === 0 ? <p>{draft.detail.mapEmpty}</p> : null}
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
                  {finding.instruction}
                </a>
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
  return (
    <main className="screen map-screen">
      <h1>{draft.detail.mapTitle}</h1>
      <HouseView results={results} />
      <a className="button" href={resultsFor(results.id)}>
        {draft.detail.backToResults}
      </a>
    </main>
  );
};
