import type { ViewPreference } from "@emberwalk/shared";
import { useState } from "react";
import { copy } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { feetSaid } from "../distance.ts";
import type { ResultFinding } from "../results.ts";

const VIEWS: ViewPreference[] = ["simple", "detailed"];

export const useView = (): [ViewPreference, (chosen: ViewPreference) => void] => {
  const deps = useDeps();
  const [view, setView] = useState<ViewPreference>(() => deps.prefs.view());
  return [
    view,
    (chosen) => {
      deps.prefs.setView(chosen);
      setView(chosen);
    },
  ];
};

export const ViewSwitch = ({ view, choose }: { view: ViewPreference; choose: (chosen: ViewPreference) => void }) => (
  <div className="views" role="group" aria-label={copy.results.views}>
    {VIEWS.map((v) => (
      <button key={v} className="button toggle" type="button" aria-pressed={view === v} onClick={() => choose(v)}>
        {copy.results[v]}
      </button>
    ))}
  </div>
);

export const DetailLines = ({ finding }: { finding: ResultFinding }) => <p data-part="distance">{copy.results.distance(feetSaid(finding.distanceFeet))}</p>;
