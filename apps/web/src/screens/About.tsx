import { useEffect, useState } from "react";
import { shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import type { Deps } from "../deps.ts";
import { accountLeftBehind, crewWords, deleteEverythingWords as words, markAccountLeft } from "../draft-words.ts";
import { SIGN_IN_FIRST } from "../erase-api.ts";
import { JUDGE } from "../judge.ts";
import { ROUTES } from "../router.ts";
import { SAMPLES } from "../samples.ts";

type Phase = "idle" | "confirm" | "working" | "done" | "doneAccountKept" | "busy" | "offline" | "failed" | "signIn";

const saidFor = (phase: Phase): string | undefined =>
  ({ signIn: words.signInFirst, working: words.working, done: words.done, doneAccountKept: words.doneAccountKept, busy: words.busy, offline: words.offline, failed: words.failed })[phase as "signIn"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const deleteEverythingShown = (deps: Deps): boolean => deps.limits.deleteEverythingOn;

export const About = () => <AboutScreen />;

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
  let kept = accountLeftBehind();
  for (;;) {
    const answer = await deps.erase.everything();
    if (answer.value === undefined) return answer.code === SIGN_IN_FIRST ? "signIn" : answer.code === "offline" ? "offline" : answer.code === "conflict" ? "busy" : "failed";
    kept ||= answer.value.accountKept === true;
    if (answer.value.left === 0) break;
    if (answer.value.left >= left) return "failed";
    left = answer.value.left;
  }
  try {
    await deps.forgetSent();
    if (!kept) return "done";
    markAccountLeft();
    return "doneAccountKept";
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

  const said = saidFor(phase);
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
          ) : phase === "doneAccountKept" || phase === "signIn" ? (
            <a className="button" href={ROUTES.signIn}>
              {words.signIn}
            </a>
          ) : phase === "working" || phase === "done" ? null : (
            <button type="button" className="button" onClick={() => setPhase("confirm")}>
              {words.start}
            </button>
          )}
        </section>
      ) : null}
      {JUDGE ? null : (
        <a className="button" data-part="list-your-crew" href={ROUTES.crews}>
          {crewWords.entry}
        </a>
      )}
      <a className="button" href={ROUTES.home}>
        {words.back}
      </a>
    </main>
  );
};
