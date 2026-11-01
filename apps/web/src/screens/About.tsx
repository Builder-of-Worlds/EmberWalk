import { useEffect, useState } from "react";
import { shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import type { Deps } from "../deps.ts";
import { deleteEverythingWords as words, draftWordsShown } from "../draft-words.ts";
import { ROUTES } from "../router.ts";
import { SAMPLES } from "../samples.ts";

type Phase = "idle" | "confirm" | "working" | "done" | "busy" | "offline" | "failed";

const SAID: Partial<Record<Phase, string>> = { working: words.working, done: words.done, busy: words.busy, offline: words.offline, failed: words.failed };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const deleteEverythingShown = (deps: Deps): boolean => deps.limits.deleteEverythingOn && draftWordsShown();

export const About = () => (draftWordsShown() ? <AboutScreen /> : null);

const rulesRead = async (deps: Deps): Promise<string | null> => {
  const samples = await Promise.all(SAMPLES.map((sample) => deps.results(sample.id).catch(() => null)));
  const days = samples
    .flatMap((sample) => sample?.findings ?? [])
    .flatMap((finding) => finding.sources)
    .map((source) => source.retrievedOn)
    .filter((day) => typeof day === "string" && ISO_DAY.test(day))
    .sort();
  const first = days[0];
  const last = days[days.length - 1];
  return first === undefined || last === undefined ? null : words.rulesRead(shortDay(first), shortDay(last));
};

const eraseAll = async (deps: Deps): Promise<Phase> => {
  let left = Number.POSITIVE_INFINITY;
  for (;;) {
    const answer = await deps.erase.everything();
    if (answer.value === undefined) return answer.code === "offline" ? "offline" : answer.code === "conflict" ? "busy" : "failed";
    if (answer.value.left === 0) break;
    if (answer.value.left >= left) return "failed";
    left = answer.value.left;
  }
  try {
    await deps.forgetSent();
    return "done";
  } catch {
    return "failed";
  }
};

const AboutScreen = () => {
  const deps = useDeps();
  const [phase, setPhase] = useState<Phase>("idle");
  const [readOn, setReadOn] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void rulesRead(deps).then((line) => {
      if (live) setReadOn(line);
    });
    return () => {
      live = false;
    };
  }, [deps]);

  const erase = async () => {
    setPhase("working");
    setPhase(await eraseAll(deps));
  };

  const said = SAID[phase];
  return (
    <main className="screen about" data-phase={phase}>
      <h1>{words.title}</h1>
      <p>{words.notInspection}</p>
      {readOn === null ? null : <p className="rules-read">{readOn}</p>}
      {deleteEverythingShown(deps) ? (
        <section className="erase" aria-labelledby="delete-everything">
          <h2 id="delete-everything">{words.heading}</h2>
          <p>{phase === "confirm" ? words.confirm : words.lead}</p>
          <p>{words.kept}</p>
          {said === undefined ? null : <p role="status">{said}</p>}
          {phase === "confirm" ? (
            <>
              <button type="button" className="button" onClick={() => void erase()}>
                {words.yes}
              </button>
              <button type="button" className="button" onClick={() => setPhase("idle")}>
                {words.no}
              </button>
            </>
          ) : phase === "working" || phase === "done" ? null : (
            <button type="button" className="button" onClick={() => setPhase("confirm")}>
              {words.start}
            </button>
          )}
        </section>
      ) : null}
      <a className="button" href={ROUTES.home}>
        {words.back}
      </a>
    </main>
  );
};
