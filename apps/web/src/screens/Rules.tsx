import { useEffect, useState } from "react";
import { draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { JURISDICTIONS, jurisdictionFor } from "../location.ts";
import type { Jurisdiction } from "../location.ts";
import { ROUTES } from "../router.ts";

type Finding = { kind: "finding" } | { kind: "found" } | { kind: "outside" } | { kind: "refused" };

export const Rules = () => {
  const deps = useDeps();
  const [finding, setFinding] = useState<Finding>({ kind: "finding" });
  const [choice, setChoice] = useState<Jurisdiction | null>(null);

  useEffect(() => {
    let live = true;
    void deps
      .locate()
      .catch(() => ({ refusal: "unavailable" as const }))
      .then((spot) => {
        if (!live) return;
        if ("refusal" in spot) return setFinding({ kind: "refused" });
        const found = jurisdictionFor(spot);
        setFinding({ kind: found === null ? "outside" : "found" });
        setChoice((chosen) => chosen ?? found);
      });
    return () => {
      live = false;
    };
  }, [deps]);

  const confirm = () => {
    if (choice === null) return;
    deps.prefs.setJurisdiction(choice);
    window.location.hash = ROUTES.record;
  };

  return (
    <main className="screen">
      <h1>{draft.rules.title}</h1>
      <p role="status">{draft.rules[finding.kind]}</p>
      {finding.kind === "finding" ? null : (
        <fieldset className="choices">
          {JURISDICTIONS.map((code) => (
            <label key={code} className="choice">
              <input type="radio" name="jurisdiction" value={code} checked={choice === code} onChange={() => setChoice(code)} />
              <span>{draft.rules.choices[code]}</span>
            </label>
          ))}
        </fieldset>
      )}
      <button className="button primary" type="button" disabled={choice === null} onClick={confirm}>
        {draft.rules.confirm}
      </button>
    </main>
  );
};
