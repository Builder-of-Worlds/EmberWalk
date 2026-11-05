import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { PropertyEntry } from "@emberwalk/shared";
import { OFFLINE } from "../account-api.ts";
import { shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { billingWords, portfolioWords as w, signInWords } from "../draft-words.ts";
import { propertyFor, ROUTES } from "../router.ts";
import { useSignedIn } from "./use-signed-in.ts";

const Tile = ({ home }: { home: PropertyEntry }) => {
  const latest = home.walks[0];
  const open = home.walks.find((walk) => walk.state.name === "done")?.openItems ?? 0;
  return (
    <li data-home={home.id} data-status={home.status}>
      <b>{home.label}</b>
      <p className="status-line">{w.status[home.status]}</p>
      <p>{w.openItems(open)}</p>
      <p>{latest === undefined ? w.noWalkYet : w.lastWalk(shortDay(latest.walkedOn))}</p>
      <a className="button" href={propertyFor(home.id)}>
        {w.open}
      </a>
    </li>
  );
};

export const Homes = () => {
  const { portfolio } = useDeps();
  const signedIn = useSignedIn(true);
  const [homes, setHomes] = useState<PropertyEntry[] | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const sample = homes !== null && homes.length > 0 && homes.every((home) => home.synthetic);

  useEffect(() => {
    let live = true;
    void portfolio.homes().then((answer) => {
      if (!live) return;
      if (answer.code === "unauthorized") {
        window.location.hash = ROUTES.signIn;
        return;
      }
      if (answer.code === undefined) setHomes(answer.value);
      else setLine(answer.code === OFFLINE ? w.noSignal : w.failed);
    });
    return () => {
      live = false;
    };
  }, [portfolio]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setLine(null);
    const answer = await portfolio.add(label.trim());
    if (answer.code !== undefined) {
      setLine(answer.code === "plan_needed" ? w.planNeeded : answer.code === OFFLINE ? w.noSignal : w.addFailed);
      return;
    }
    setHomes((known) => [...(known ?? []), answer.value]);
    setLabel("");
  };

  return (
    <main className="screen homes">
      <h1>{w.title}</h1>
      {signedIn.email === null ? null : <p className="status-line signed-in">{signInWords.signedInAs(signedIn.email)}</p>}
      {signedIn.phoneLine === null ? null : <p role="status">{signedIn.phoneLine}</p>}
      {sample ? <p className="status-line">{w.sampleLine}</p> : null}
      {homes !== null && homes.length === 0 ? <p>{w.empty}</p> : null}
      <ul className="lines home-list">
        {(homes ?? []).map((home) => (
          <Tile key={home.id} home={home} />
        ))}
      </ul>
      {homes === null || sample ? null : (
        <form className="form" onSubmit={(event) => void add(event)}>
          <label htmlFor="home-label">{w.addLabel}</label>
          <input id="home-label" type="text" maxLength={120} required value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type="submit" className="button">
            {w.add}
          </button>
        </form>
      )}
      {line === null ? null : <p role="alert">{line}</p>}
      {line === w.planNeeded ? (
        <a className="button primary" href={ROUTES.plan}>
          {billingWords.choosePlan}
        </a>
      ) : null}
      <a className="button" href={ROUTES.home}>
        {w.backHome}
      </a>
      {signedIn.line === null ? null : <p role="alert">{signedIn.line}</p>}
      {signedIn.email === null ? null : (
        <>
          <button type="button" className="button" onClick={() => void signedIn.signOut()}>
            {signInWords.signOut}
          </button>
          <button type="button" className="button" onClick={() => void signedIn.signOutEverywhere()}>
            {signInWords.signOutEverywhere}
          </button>
        </>
      )}
    </main>
  );
};
