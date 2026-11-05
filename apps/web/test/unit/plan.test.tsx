import { OFFER_CONFIG } from "@emberwalk/shared";
import type { PlanKind, PlanState } from "@emberwalk/shared";
import { afterEach, describe, expect, it } from "vitest";
import { walkApi } from "../../src/api.ts";
import { App } from "../../src/App.tsx";
import { billingApi, boughtHere, keepPending, noBilling, PENDING_KEY, readPending } from "../../src/billing-api.ts";
import type { BillingApi, PlanView, WalkCount } from "../../src/billing-api.ts";
import { DepsContext } from "../../src/deps.ts";
import { billingWords as w } from "../../src/draft-words.ts";
import { setLanguage } from "../../src/language.ts";
import { checkoutReturnIn, planReturnIn, ROUTES, routeFor } from "../../src/router.ts";
import { Home } from "../../src/screens/Home.tsx";
import { Plan, WAIT_MS, WAIT_TRIES } from "../../src/screens/Plan.tsx";
import { fakeClock, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const YEAR_END = "2027-11-01T12:00:00.000Z";
const CHECKOUT = "https://checkout.stripe.com/c/pay/test";
const PORTAL = "https://billing.stripe.com/p/session/test";
const [INDIVIDUAL, LANDLORD] = OFFER_CONFIG.offers;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const viewOf = (plan: PlanState, walks: WalkCount | null = null): PlanView => ({ plan, offers: [...OFFER_CONFIG.offers], walks });
const none = () => viewOf({ status: "none", renewsAt: null, kind: null });
const held = (walks: WalkCount | null = { used: 1, allowed: 4, left: 3 }, status: "active" | "past_due" = "active") =>
  viewOf({ status, renewsAt: YEAR_END, kind: "individual" }, walks);

const fake = (first: Awaited<ReturnType<BillingApi["plan"]>>, over: Partial<BillingApi> = {}) => {
  const log = { asks: 0, checkout: [] as PlanKind[], extra: [] as number[], portal: 0, left: [] as string[], answer: first };
  const billing: BillingApi = {
    plan: async () => ((log.asks += 1), log.answer),
    checkout: async (kind) => (log.checkout.push(kind), { value: { url: CHECKOUT } }),
    extraWalks: async (count) => (log.extra.push(count), { value: { url: CHECKOUT } }),
    portal: async () => ((log.portal += 1), { value: { url: PORTAL } }),
    leave: (url) => log.left.push(url),
    ...over,
  };
  return { billing, log };
};

const mounted: { unmount: () => Promise<void> }[] = [];

const open = async (billing: BillingApi, planReturn: "done" | "cancelled" | null = null, clock = fakeClock()) => {
  const view = await render(
    <DepsContext.Provider value={testDeps({ billing, clock: clock.clock })}>
      <Plan planReturn={planReturn} />
    </DepsContext.Provider>,
  );
  mounted.push(view);
  await settle();
  return { ...view, clock };
};

const buttons = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("button, a.button")];
const named = (host: HTMLElement, text: string) => buttons(host).find((b) => b.textContent === text);
const tap = (host: HTMLElement, text: string) => settle(() => named(host, text)!.click());
const buyButton = (kind: PlanKind) => w.buyPlan(money(OFFER_CONFIG.offers.find((o) => o.kind === kind)!.amountCents));

afterEach(async () => {
  for (const view of mounted.splice(0)) await view.unmount();
  window.sessionStorage.clear();
  window.location.hash = "";
  window.history.replaceState(null, "", "/");
  setLanguage("en");
});

describe("payments off", () => {
  it("promises no purchase and states nothing about a plan", async () => {
    const view = await open(noBilling);
    expect(view.text()).toContain(w.notOpen);
    expect(view.text()).not.toContain("$");
    expect(buttons(view.host).map((b) => b.textContent)).toEqual([w.home]);
  });

  it("Home shows no way to a plan while payments are off, and shows one when they are on", async () => {
    const show = async (billing: BillingApi) => {
      const view = await render(
        <DepsContext.Provider value={testDeps({ billing })}>
          <Home />
        </DepsContext.Provider>,
      );
      mounted.push(view);
      await settle();
      return [...view.host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    };
    expect(await show(noBilling)).not.toContain(ROUTES.plan);
    expect(await show(fake({ value: none() }).billing)).toContain(ROUTES.plan);
  });

  it("never shows a way to a plan on Home when the phone has no signal", async () => {
    const view = await render(
      <DepsContext.Provider value={testDeps({ billing: fake({ code: "offline" }).billing })}>
        <Home />
      </DepsContext.Provider>,
    );
    mounted.push(view);
    await settle();
    expect([...view.host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).not.toContain(ROUTES.plan);
  });
});

describe("choosing a plan", () => {
  it("offers both plans with the amounts and walks from the one config", async () => {
    const view = await open(fake({ value: none() }).billing);
    for (const offer of [INDIVIDUAL, LANDLORD]) {
      expect(view.text()).toContain(w.name[offer.kind]);
      expect(view.text()).toContain(w.price(money(offer.amountCents)));
      expect(view.text()).toContain(w.walksAYear(offer.walksPerYear));
    }
    expect(view.text()).toContain(w.sampleFree);
  });

  it("follows a changed price in the config, never a typed amount", () => {
    expect(buyButton("individual")).toContain(money(INDIVIDUAL.amountCents));
    expect(w.price("$1.00")).toContain("$1.00");
  });

  it.each(["individual", "landlord"] as const)("sends the %s choice to Checkout and leaves for Stripe's link", async (kind) => {
    const { billing, log } = fake({ value: none() });
    const view = await open(billing);
    await tap(view.host, buyButton(kind));
    expect(log.checkout).toEqual([kind]);
    expect(log.left).toEqual([CHECKOUT]);
    expect(readPending()).toEqual({ kind: "plan" });
  });

  it.each([
    ["offline", () => w.noSignal],
    ["provider_error", () => w.stripeDown],
    ["not_set_up", () => w.notAvailable],
    ["server_error", () => w.didNotWork],
  ])("stays on the screen and explains when Checkout answers %s", async (code, line) => {
    const { billing, log } = fake({ value: none() }, { checkout: async () => ({ code }) });
    const view = await open(billing);
    await tap(view.host, buyButton("individual"));
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(line());
    expect(log.left).toEqual([]);
  });

  it("reads the plan again when Checkout says the visitor already has one", async () => {
    const { billing, log } = fake({ value: none() }, {
      checkout: async () => {
        log.answer = { value: held() };
        return { code: "conflict" };
      },
    });
    const view = await open(billing);
    await tap(view.host, buyButton("individual"));
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(w.already);
    expect(named(view.host, buyButton("individual"))).toBeUndefined();
    expect(view.text()).toContain(w.walksLine(1, 3));
  });

  it.each(["canceled", "incomplete_expired", "incomplete"] as const)("lets a visitor whose plan is %s choose again", async (status) => {
    const view = await open(fake({ value: viewOf({ status, renewsAt: null, kind: "individual" }) }).billing);
    expect(named(view.host, buyButton("landlord"))).toBeDefined();
  });

  it("offers Try Again with no signal and shows the plans once there is signal", async () => {
    const { billing, log } = fake({ code: "offline" });
    const view = await open(billing);
    expect(view.text()).toContain(w.noSignal);
    expect(named(view.host, buyButton("individual"))).toBeUndefined();
    log.answer = { value: none() };
    await tap(view.host, w.tryAgain);
    expect(named(view.host, buyButton("individual"))).toBeDefined();
  });
});

describe("holding a plan", () => {
  it("shows the plan, walks used and left, and when the plan year ends, with no renewal promise", async () => {
    const view = await open(fake({ value: held() }).billing);
    expect(view.text()).toContain(w.name.individual);
    expect(view.text()).toContain(w.walksLine(1, 3));
    expect(view.text()).toContain("November");
    expect(view.text()).not.toMatch(/renews on/i);
    expect(named(view.host, buyButton("individual"))).toBeUndefined();
  });

  it("buys the chosen number of extra walks at the config's price and remembers the walks to expect", async () => {
    const { billing, log } = fake({ value: held() });
    const view = await open(billing);
    const count = view.host.querySelector<HTMLSelectElement>("select")!;
    expect(count.options.length).toBe(15);
    await settle(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      set.call(count, "3");
      count.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await tap(view.host, w.buyExtra(3, money(OFFER_CONFIG.extraWalk.amountCents * 3)));
    expect(log.extra).toEqual([3]);
    expect(log.left).toEqual([CHECKOUT]);
    expect(readPending()).toEqual({ kind: "extra", allowedAfter: 7 });
  });

  it("opens the portal to manage or cancel", async () => {
    const { billing, log } = fake({ value: held() });
    const view = await open(billing);
    await tap(view.host, w.manage);
    expect(log.portal).toBe(1);
    expect(log.left).toEqual([PORTAL]);
  });

  it("explains when the portal cannot open", async () => {
    const { billing, log } = fake({ value: held() }, { portal: async () => ({ code: "not_found" }) });
    const view = await open(billing);
    await tap(view.host, w.manage);
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(w.didNotWork);
    expect(log.left).toEqual([]);
  });

  it("warns about a failed payment and keeps the walks", async () => {
    const view = await open(fake({ value: held(undefined, "past_due") }).billing);
    expect(view.text()).toContain(w.pastDue);
    expect(view.text()).toContain(w.walksLine(1, 3));
  });

  it("uses one walk in the singular", () => {
    expect(w.walksLine(1, 1)).toBe("1 walk used, 1 left this plan year.");
  });

  it.each([
    ["refunded", () => w.refunded],
    ["unpaid", () => w.onHold],
    ["paused", () => w.onHold],
  ] as const)("a %s plan cannot buy again and points to the portal", async (status, line) => {
    const plan = (status === "refunded" ? { status, renewsAt: null, kind: "individual" } : { status, renewsAt: YEAR_END, kind: "individual" }) as PlanState;
    const view = await open(fake({ value: viewOf(plan) }).billing);
    expect(view.text()).toContain(line());
    expect(named(view.host, w.manage)).toBeDefined();
    expect(named(view.host, buyButton("individual"))).toBeUndefined();
  });
});

describe("an individual plan and more than one home", () => {
  it("names the landlord plan and how to reach it", async () => {
    const view = await open(fake({ value: held() }).billing);
    expect(view.text()).toContain(w.toLandlord);
    expect(w.toLandlord).toContain("hello@emberwalk.app");
    expect(w.toLandlord).not.toContain(w.manage);
  });

  it("remembers only a plan bought here, for Home's sign in line", async () => {
    keepPending({ kind: "extra", allowedAfter: 4 });
    await open(fake({ value: held() }).billing, "done");
    expect(boughtHere()).toBe(false);
    keepPending({ kind: "plan" });
    await open(fake({ value: held() }).billing, "done");
    expect(boughtHere()).toBe(true);
  });

  it("says nothing of the kind to a landlord plan", async () => {
    const view = await open(fake({ value: viewOf({ status: "active", renewsAt: YEAR_END, kind: "landlord" }, { used: 0, allowed: 15, left: 15 }) }).billing);
    expect(view.text()).not.toContain(w.toLandlord);
  });
});

describe("a return with no purchase started in this browser", () => {
  it("a bare return with no plan does not wait: it says the truth and offers the plans at once", async () => {
    const { billing, log } = fake({ value: none() });
    const view = await open(billing, "done");
    expect(view.text()).toContain(w.notHere);
    expect(view.text()).not.toContain(w.confirming);
    expect(view.text()).not.toContain(w.stillConfirming);
    expect(named(view.host, buyButton("individual"))).toBeDefined();
    await settle(() => view.clock.advance(WAIT_MS * 3));
    expect(log.asks).toBe(1);
  });

  it("a bare return that holds a plan just shows it", async () => {
    const view = await open(fake({ value: held() }).billing, "done");
    expect(view.text()).toContain(w.walksLine(1, 3));
    expect(view.text()).not.toContain(w.notHere);
  });
});

describe("back from Stripe", () => {
  it("thanks a buyer whose plan has arrived", async () => {
    keepPending({ kind: "plan" });
    const view = await open(fake({ value: held() }).billing, "done");
    expect(view.text()).toContain(w.done);
    expect(view.text()).toContain(w.walksLine(1, 3));
  });

  it("a walk started during Checkout does not make the extra walks wait forever", async () => {
    keepPending({ kind: "extra", allowedAfter: 7 });
    const view = await open(fake({ value: held({ used: 2, allowed: 7, left: 5 }) }).billing, "done");
    expect(view.text()).toContain(w.doneExtra);
    expect(view.text()).not.toContain(w.confirming);
  });

  it("an extra walks return never says the plan is ready when the counts cannot be read", async () => {
    keepPending({ kind: "extra", allowedAfter: 7 });
    const { billing } = fake({ value: held(null) });
    const view = await open(billing, "done");
    expect(view.text()).toContain(w.confirming);
    expect(view.text()).not.toContain(w.done);
    for (let i = 0; i < WAIT_TRIES + 1; i++) {
      await settle(() => view.clock.advance(WAIT_MS));
      await settle();
    }
    expect(view.text()).toContain(w.countUnread);
    expect(view.text()).not.toContain(w.done);
    expect(named(view.host, w.checkAgain)).toBeDefined();
  });

  it("extra walks bought while the count was unreadable say what is known, not that they are added", async () => {
    keepPending({ kind: "extra", allowedAfter: null });
    const view = await open(fake({ value: held() }).billing, "done");
    expect(view.text()).toContain(w.extraOnWay);
    expect(view.text()).not.toContain(w.doneExtra);
    expect(view.text()).not.toContain(w.done);
  });

  it("while the webhook has not arrived, says so, offers no purchase, and shows the plan once it comes", async () => {
    keepPending({ kind: "plan" });
    const { billing, log } = fake({ value: none() });
    const view = await open(billing, "done");
    expect(view.text()).toContain(w.confirming);
    expect(named(view.host, buyButton("individual"))).toBeUndefined();
    log.answer = { value: held() };
    await settle(() => view.clock.advance(WAIT_MS));
    await settle();
    expect(view.text()).toContain(w.done);
    expect(view.text()).not.toContain(w.confirming);
  });

  it("stops asking after its tries, tells the buyer not to buy again, and can check again", async () => {
    keepPending({ kind: "plan" });
    const { billing, log } = fake({ value: none() });
    const view = await open(billing, "done");
    for (let i = 0; i < WAIT_TRIES + 3; i++) {
      await settle(() => view.clock.advance(WAIT_MS));
      await settle();
    }
    expect(log.asks).toBeLessThanOrEqual(WAIT_TRIES + 1);
    expect(view.text()).toContain(w.stillConfirming);
    expect(named(view.host, buyButton("individual"))).toBeUndefined();
    log.answer = { value: held() };
    await tap(view.host, w.checkAgain);
    expect(view.text()).toContain(w.done);
  });

  it("waits for extra walks to arrive, then clears what it expected", async () => {
    keepPending({ kind: "extra", allowedAfter: 7 });
    const { billing, log } = fake({ value: held({ used: 1, allowed: 4, left: 3 }) });
    const view = await open(billing, "done");
    expect(view.text()).toContain(w.confirming);
    log.answer = { value: held({ used: 1, allowed: 7, left: 6 }) };
    await settle(() => view.clock.advance(WAIT_MS));
    await settle();
    expect(view.text()).toContain(w.doneExtra);
    expect(window.sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("after an abandoned Checkout, says nothing was charged and offers the plans again", async () => {
    keepPending({ kind: "plan" });
    const view = await open(fake({ value: none() }).billing, "cancelled");
    expect(view.text()).toContain(w.cancelled);
    expect(named(view.host, buyButton("individual"))).toBeDefined();
    expect(window.sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("takes the buttons back when the browser's Back button returns from Stripe", async () => {
    const { billing } = fake({ value: none() });
    const view = await open(billing);
    await tap(view.host, buyButton("individual"));
    expect((named(view.host, buyButton("individual")) as HTMLButtonElement).disabled).toBe(true);
    await settle(() => window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })));
    expect((named(view.host, buyButton("individual")) as HTMLButtonElement).disabled).toBe(false);
  });

  it("with payments off, a return address still promises nothing", async () => {
    const view = await open(noBilling, "done");
    expect(view.text()).toContain(w.notOpen);
    expect(view.text()).not.toContain(w.confirming);
  });
});

describe("the return address", () => {
  it("reads only Stripe's two return words", () => {
    expect(checkoutReturnIn("?checkout=done")).toBe("#/plan/done");
    expect(checkoutReturnIn("?checkout=cancelled")).toBe("#/plan/cancelled");
    for (const search of ["", "?checkout=other", "?x=1"]) expect(checkoutReturnIn(search)).toBeNull();
  });

  it("routes the plan hashes", () => {
    expect(routeFor(ROUTES.plan)).toBe("plan");
    expect(routeFor("#/plan/done")).toBe("plan");
    expect(planReturnIn("#/plan/done")).toBe("done");
    expect(planReturnIn("#/plan/cancelled")).toBe("cancelled");
    expect(planReturnIn("#/plan/other")).toBeNull();
    expect(planReturnIn(ROUTES.plan)).toBeNull();
  });

  it("the app opens the return state and drops the word from the address so a reload stays right", async () => {
    window.history.replaceState(null, "", "/?checkout=cancelled");
    const view = await render(<App deps={testDeps({ billing: fake({ value: none() }).billing })} />);
    mounted.push(view);
    await settle();
    expect(view.text()).toContain(w.cancelled);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/plan/cancelled");
  });
});

describe("the billing client", () => {
  const client = (answer: (request: Request) => Response) => {
    const seen: Request[] = [];
    return { seen, api: billingApi("http://localhost", async (r) => (seen.push(r), answer(r)), () => "visitor", () => undefined) };
  };
  const planBody = (status: string) => ({ plan: { status, renewsAt: null, kind: status === "none" ? null : "individual" }, offers: OFFER_CONFIG.offers });

  it("hears not open from the server", async () => {
    const { api } = client(() => Response.json({ error: { code: "not_open", message: "x" } }, { status: 503 }));
    expect((await api.plan()).code).toBe("not_open");
  });

  it("asks for walk counts only for a plan that holds", async () => {
    const none = client(() => Response.json(planBody("none")));
    expect((await none.api.plan()).value?.walks).toBeNull();
    expect(none.seen.length).toBe(1);
    const active = client((r) => Response.json(new URL(r.url).pathname.endsWith("/walks") ? { walks: { used: 2, allowed: 4, left: 2 } } : planBody("active")));
    expect((await active.api.plan()).value?.walks).toEqual({ used: 2, allowed: 4, left: 2 });
  });

  it("still shows the plan when the walk counts cannot be read", async () => {
    const { api } = client((r) => (new URL(r.url).pathname.endsWith("/walks") ? new Response("no", { status: 500 }) : Response.json(planBody("active"))));
    expect((await api.plan()).value?.plan.status).toBe("active");
  });

  it("refuses a link that is not Stripe's", async () => {
    const { api } = client(() => Response.json({ url: "https://example.com/pay" }));
    expect((await api.checkout("individual")).code).toBe("server_error");
    expect((await api.portal()).code).toBe("server_error");
  });
});

describe("the walk gate reaches the phone", () => {
  it.each(["plan_needed", "walks_used"])("keeps %s from a walk start", async (code) => {
    const walks = walkApi("http://localhost", async () => Response.json({ error: { code, message: "x" } }, { status: 402 }));
    expect((await walks.status("w")).code).toBe(code);
  });

  it("leaves an unknown code as a server error", async () => {
    const walks = walkApi("http://localhost", async () => Response.json({ error: { code: "other", message: "x" } }, { status: 402 }));
    expect((await walks.status("w")).code).toBe("server_error");
  });
});
