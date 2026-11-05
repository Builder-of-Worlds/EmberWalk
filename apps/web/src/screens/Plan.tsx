import { holdsPlan, MAX_EXTRA_WALKS, OFFER_CONFIG } from "@emberwalk/shared";
import type { PlanKind } from "@emberwalk/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { OFFLINE } from "../account-api.ts";
import type { Asked } from "../account-api.ts";
import { keepBoughtHere, keepPending, NOT_OPEN, readPending } from "../billing-api.ts";
import type { Link, Pending, PlanView } from "../billing-api.ts";
import { longDate } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { billingWords as w } from "../draft-words.ts";
import { language } from "../language.ts";
import { ROUTES } from "../router.ts";
import type { PlanReturn } from "../router.ts";

export const WAIT_MS = 3000;
export const WAIT_TRIES = 20;

const money = (cents: number): string =>
  new Intl.NumberFormat(language() === "es" ? "es-US" : "en-US", { style: "currency", currency: OFFER_CONFIG.extraWalk.currency.toUpperCase() }).format(cents / 100);

const failureLine = (code: string): string => {
  if (code === OFFLINE) return w.noSignal;
  if (code === "provider_error") return w.stripeDown;
  if (code === "not_set_up" || code === NOT_OPEN) return w.notAvailable;
  return code === "conflict" ? w.already : w.didNotWork;
};

const ON_HOLD: ReadonlySet<string> = new Set(["unpaid", "paused"]);

const hasArrived = (view: PlanView, pending: Pending | null): boolean => {
  if (pending === null) return true;
  if (!holdsPlan(view.plan.status)) return false;
  if (pending.kind === "plan" || pending.allowedAfter === null) return true;
  return view.walks !== null && view.walks.allowed >= pending.allowedAfter;
};

const doneLine = (pending: Pending | null, holding: boolean): string => {
  if (pending === null) return holding ? w.done : w.notHere;
  if (pending.kind === "plan") return w.done;
  return pending.allowedAfter === null ? w.extraOnWay : w.doneExtra;
};

const HomeLink = () => (
  <a className="button" href={ROUTES.home}>
    {w.home}
  </a>
);

export const PlanEntry = () => {
  const { billing } = useDeps();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void billing.plan().then((answer) => {
      if (live) setOpen(answer.code === undefined);
    });
    return () => {
      live = false;
    };
  }, [billing]);
  return open ? (
    <a className="button" href={ROUTES.plan}>
      {w.entry}
    </a>
  ) : null;
};

const Offers = ({ busy, buy }: { busy: boolean; buy: (kind: PlanKind) => void }) => (
  <>
    <p>{w.lead}</p>
    <ul className="lines home-list">
      {OFFER_CONFIG.offers.map((offer) => (
        <li key={offer.kind} data-offer={offer.kind}>
          <b>{w.name[offer.kind]}</b>
          <p>{w.price(money(offer.amountCents))}</p>
          <p>{w.walksAYear(offer.walksPerYear)}</p>
          <button className="button primary" type="button" disabled={busy} onClick={() => buy(offer.kind)}>
            {w.buyPlan(money(offer.amountCents))}
          </button>
        </li>
      ))}
    </ul>
    <p>{w.sampleFree}</p>
  </>
);

const ExtraWalks = ({ busy, buy }: { busy: boolean; buy: (count: number) => void }) => {
  const [count, setCount] = useState(1);
  const each = OFFER_CONFIG.extraWalk.amountCents;
  return (
    <section className="form">
      <h2>{w.extraHeading}</h2>
      <p>{w.extraLead(money(each))}</p>
      <label htmlFor="extra-count">{w.extraCount}</label>
      <select id="extra-count" value={count} onChange={(event) => setCount(Number(event.target.value))}>
        {Array.from({ length: MAX_EXTRA_WALKS }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button className="button" type="button" disabled={busy} onClick={() => buy(count)}>
        {w.buyExtra(count, money(each * count))}
      </button>
    </section>
  );
};

export const Plan = ({ planReturn }: { planReturn: PlanReturn | null }) => {
  const { billing, clock } = useDeps();
  const [answer, setAnswer] = useState<Asked<PlanView> | null>(null);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [pending] = useState(() => (planReturn === "done" ? readPending() : null));
  const live = useRef(true);

  const load = useCallback(async () => {
    const next = await billing.plan();
    if (live.current) setAnswer(next);
  }, [billing]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (planReturn === "cancelled") keepPending(null);
  }, [planReturn]);

  useEffect(() => {
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);

  const view = answer?.value ?? null;
  const arrived = view !== null && hasArrived(view, pending);
  const waiting = planReturn === "done" && view !== null && !arrived;

  useEffect(() => {
    if (!waiting || tries >= WAIT_TRIES) return;
    return clock.later(() => {
      setTries((n) => n + 1);
      void load();
    }, WAIT_MS);
  }, [waiting, tries, clock, load]);

  useEffect(() => {
    if (planReturn !== "done" || !arrived) return;
    if (pending?.kind === "plan") keepBoughtHere(true);
    keepPending(null);
  }, [planReturn, arrived, pending]);

  const leaveFor = async (ask: () => Promise<Asked<Link>>, expecting: Pending | null = null) => {
    setBusy(true);
    setLine(null);
    const link = await ask();
    if (link.code === undefined) {
      keepPending(expecting);
      billing.leave(link.value.url);
      return;
    }
    setBusy(false);
    setLine(failureLine(link.code));
    if (link.code === "conflict" || link.code === NOT_OPEN) void load();
  };

  const body = () => {
    if (answer === null) return <p role="status">{w.loading}</p>;
    if (answer.code === NOT_OPEN) return <p>{w.notOpen}</p>;
    if (view === null)
      return (
        <>
          <p role="alert">{answer.code === OFFLINE ? w.noSignal : w.failed}</p>
          <button className="button primary" type="button" onClick={() => void load()}>
            {w.tryAgain}
          </button>
        </>
      );
    if (waiting) {
      const gaveUp = tries >= WAIT_TRIES;
      return (
        <>
          <p className="status-line" role="status">
            {!gaveUp ? w.confirming : holdsPlan(view.plan.status) && view.walks === null ? w.countUnread : w.stillConfirming}
          </p>
          {gaveUp ? (
            <button
              className="button primary"
              type="button"
              onClick={() => {
                setTries(0);
                void load();
              }}
            >
              {w.checkAgain}
            </button>
          ) : null}
        </>
      );
    }
    const { plan, walks } = view;
    const manage = (
      <button className="button" type="button" disabled={busy} onClick={() => void leaveFor(billing.portal)}>
        {w.manage}
      </button>
    );
    const returned = planReturn === null ? null : planReturn === "cancelled" ? w.cancelled : doneLine(pending, holdsPlan(plan.status));
    const told =
      returned === null ? null : (
        <p className="status-line" role="status">
          {returned}
        </p>
      );
    if (holdsPlan(plan.status))
      return (
        <>
          {told}
          {plan.kind === null ? null : <p className="status-line">{w.name[plan.kind]}</p>}
          {plan.status === "past_due" ? <p role="alert">{w.pastDue}</p> : null}
          {walks === null ? null : <p className="status-line">{w.walksLine(walks.used, walks.left)}</p>}
          {plan.renewsAt === null ? null : <p>{w.yearEnds(longDate(new Date(plan.renewsAt)))}</p>}
          <p>{w.sampleFree}</p>
          {plan.kind === "individual" ? <p>{w.toLandlord}</p> : null}
          <ExtraWalks
            busy={busy}
            buy={(count) => void leaveFor(() => billing.extraWalks(count), { kind: "extra", allowedAfter: walks === null ? null : walks.allowed + count })}
          />
          {manage}
        </>
      );
    if (plan.status === "refunded" || ON_HOLD.has(plan.status))
      return (
        <>
          {told}
          <p>{plan.status === "refunded" ? w.refunded : w.onHold}</p>
          {manage}
        </>
      );
    return (
      <>
        {told}
        {plan.status === "canceled" ? <p className="status-line">{w.ended}</p> : null}
        <Offers busy={busy} buy={(kind) => void leaveFor(() => billing.checkout(kind), { kind: "plan" })} />
      </>
    );
  };

  return (
    <main className="screen plan">
      <h1>{w.title}</h1>
      {body()}
      {busy ? <p role="status">{w.leaving}</p> : null}
      {line === null ? null : <p role="alert">{line}</p>}
      <HomeLink />
    </main>
  );
};
