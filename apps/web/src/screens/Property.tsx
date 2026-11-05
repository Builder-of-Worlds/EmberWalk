import { useCallback, useEffect, useState } from "react";
import type { PropertyEntry } from "@emberwalk/shared";
import { OFFLINE } from "../account-api.ts";
import { CONCEPT_WORDS, shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { portfolioWords as w } from "../draft-words.ts";
import { localDay } from "../mark-sync.ts";
import { fixFor, inviteFor, resultsFor, ROUTES, WALK_START } from "../router.ts";
import { holdClaim } from "../walk-claim.ts";

const conceptWords = (concept: string): string => {
  const words = (CONCEPT_WORDS as Record<string, string>)[concept] ?? concept;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

type Walk = PropertyEntry["walks"][number];

const WalkRow = ({ walk, mark, marking }: { walk: Walk; mark: (findingId: string) => void; marking: boolean }) => (
  <li data-walk={walk.walkId}>
    <b>{w.walkedOn(shortDay(walk.walkedOn))}</b>
    <p>{walk.byTenant ? w.byTenant : w.byYou}</p>
    {walk.state.name === "failed" ? <p>{w.notFinished}</p> : null}
    {walk.state.name !== "done" && walk.state.name !== "failed" ? <p>{w.stillChecking}</p> : null}
    {walk.open.length === 0 ? null : (
      <>
        <h3>{w.openHeading}</h3>
        <ul className="lines">
          {walk.open.map((item) => (
            <li key={item.findingId} data-open={item.findingId}>
              <span>
                {conceptWords(item.concept)}, {item.requiredNow ? w.requiredNow : w.recommended}
              </span>
              {walk.synthetic ? null : (
                <button type="button" className="button" data-mark={item.findingId} disabled={marking} onClick={() => mark(item.findingId)}>
                  {w.markDone}
                </button>
              )}
            </li>
          ))}
        </ul>
      </>
    )}
    {walk.doneMarks.length === 0 ? null : (
      <>
        <h3>{w.doneHeading}</h3>
        <ul className="lines">
          {walk.doneMarks.map((done) => (
            <li key={done.findingId} data-done={done.findingId}>
              {w.doneOn(conceptWords(done.concept), shortDay(done.doneOn))}
            </li>
          ))}
        </ul>
      </>
    )}
    {walk.state.name === "done" && !walk.synthetic ? (
      <>
        <a className="button" href={resultsFor(walk.walkId)}>
          {w.results}
        </a>
        <a className="button" href={fixFor(walk.walkId)}>
          {w.getItFixed}
        </a>
      </>
    ) : null}
  </li>
);

export const Property = ({ propertyId }: { propertyId: string | null }) => {
  const { portfolio, clock } = useDeps();
  const [home, setHome] = useState<PropertyEntry | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    const answer = await portfolio.one(propertyId ?? "");
    if (answer.code === "unauthorized") {
      window.location.hash = ROUTES.signIn;
      return;
    }
    if (answer.code === undefined) {
      setHome(answer.value);
      setLine(null);
    } else setLine(answer.code === OFFLINE ? w.noSignal : answer.code === "not_found" ? w.notFound : w.failed);
  }, [portfolio, propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mark = async (findingId: string) => {
    setMarking(true);
    const answer = await portfolio.markDone(findingId, localDay(clock.now()));
    if (answer.code === undefined) await load();
    else setLine(answer.code === OFFLINE ? w.noSignal : w.markFailed);
    setMarking(false);
  };

  return (
    <main className="screen property">
      <h1>{home?.label ?? w.title}</h1>
      {home === null ? null : (
        <>
          <p className="status-line" data-status={home.status}>
            {w.status[home.status]}
          </p>
          {home.synthetic ? (
            <p className="status-line">{w.sampleLine}</p>
          ) : (
            <>
              <a className="button primary" href={inviteFor(home.id)}>
                {w.invite}
              </a>
              <a className="button" href={WALK_START} onClick={() => holdClaim({ propertyId: home.id })}>
                {w.walkIt}
              </a>
              <a className="button" data-part="record" href={`/api/properties/${encodeURIComponent(home.id)}/record`} download>
                {w.record}
              </a>
            </>
          )}
          <h2>{w.walks}</h2>
          {home.walks.length === 0 ? <p>{w.noWalks}</p> : null}
          <ul className="lines walk-list">
            {home.walks.map((walk) => (
              <WalkRow key={walk.walkId} walk={walk} marking={marking} mark={(id) => void mark(id)} />
            ))}
          </ul>
        </>
      )}
      {line === null ? null : <p role="alert">{line}</p>}
      <a className="button" href={ROUTES.homes}>
        {w.backHomes}
      </a>
    </main>
  );
};
