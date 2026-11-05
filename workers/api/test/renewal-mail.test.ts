import { env } from "cloudflare:workers";
import { limitsWith } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type BillingDeps, handleBilling } from "../src/billing-route.ts";
import { clearWalks, seedWalk } from "./seed.ts";
import { charge, CUSTOMER, event, PRICES, SECRET_KEY, signedHeader, SUBSCRIPTION, subscription, T0, VISITOR, WEBHOOK_SECRET } from "./stripe-shapes.ts";

const YEAR = 365 * 24 * 3600;
const PORTAL = "https://billing.stripe.com/p/login/test_aBcDeFg";
const FOOTER = "EmberWalk, The Arbiter Bibendi LLC, 1 Example Way, Sacramento, CA 95814";
const RENEWS = T0 + YEAR;
const RENEWS_ON = new Date(RENEWS * 1000).toISOString().slice(0, 10);
const NOTICE_AT = RENEWS - 20 * 86400;

type Mail = { url: string; headers: Headers; body: { from: string; to: string[]; subject: string; text: string } };

const setup = (over: Partial<BillingDeps> = {}, mailAnswer: () => Response | Error = () => Response.json({ id: "mail_1" })) => {
  const mails: Mail[] = [];
  const logs: string[] = [];
  const stripe = { cancelAtPeriodEnd: false, looked: [] as string[] };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.resend.com/emails") {
      mails.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      const reply = mailAnswer();
      if (reply instanceof Error) throw reply;
      return reply;
    }
    if (init?.method === "DELETE") return Response.json({ id: SUBSCRIPTION, status: "canceled" });
    if (url.startsWith("https://api.stripe.com/v1/subscriptions/")) {
      stripe.looked.push(new URL(url).pathname);
      return Response.json({ id: SUBSCRIPTION, status: "active", cancel_at_period_end: stripe.cancelAtPeriodEnd });
    }
    throw new Error(`no call expected: ${url}`);
  };
  const deps: BillingDeps = {
    db: env.DB,
    limits: limitsWith({ paymentsOn: true }),
    fetch: fetchFn,
    now: () => T0 * 1000,
    stripe: { secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, prices: PRICES },
    log: (line) => logs.push(line),
    mail: { apiKey: "re_test", portalLoginUrl: PORTAL, footer: FOOTER },
    ...over,
  };
  return { deps, mails, logs, stripe };
};

const deliver = async (deps: BillingDeps, body: string) => {
  const request = new Request("https://go.emberwalk.app/api/billing/webhook", { method: "POST", body, headers: { "stripe-signature": await signedHeader(body, T0) } });
  const response = await handleBilling(request, deps, "/api/billing/webhook");
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const upcoming = (over: Record<string, unknown> = {}) => ({
  object: "invoice",
  customer: CUSTOMER,
  customer_email: "owner@home.test",
  amount_due: 1299,
  currency: "usd",
  next_payment_attempt: RENEWS,
  period_end: RENEWS,
  parent: { type: "subscription_details", subscription_details: { subscription: SUBSCRIPTION } },
  ...over,
});

const send = (id = "evt_up", over: Record<string, unknown> = {}, at = NOTICE_AT) => JSON.stringify(event(id, "invoice.upcoming", at, upcoming(over)));

const livePlan = (deps: BillingDeps) => deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", RENEWS))));

beforeEach(async () => {
  await clearWalks();
  await env.DB.batch(["plans", "stripe_events", "extra_walks", "refunded_charges", "stripe_customers"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

describe("the renewal notice before a yearly plan renews", () => {
  it("sends one branded email to the customer, with every item the law asks for, in English", async () => {
    const { deps, mails } = setup();
    await livePlan(deps);
    expect((await deliver(deps, send())).status).toBe(200);
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail?.headers.get("authorization")).toBe("Bearer re_test");
    expect(mail?.body.from).toBe("EmberWalk <hello@emberwalk.app>");
    expect(mail?.body.to).toEqual(["owner@home.test"]);
    expect(mail?.body.subject).toBe("Your EmberWalk plan renews on Oct. 31st, 2026");
    const text = mail?.body.text ?? "";
    expect(text).toContain("renews automatically on Oct. 31st, 2026 unless you cancel it first");
    expect(text).toContain("$12.99");
    expect(text).toContain("once a year");
    expect(text).toContain(`To cancel, open this link and enter the email on your plan: ${PORTAL}`);
    expect(text).toContain("hello@emberwalk.app");
    expect(text).toContain("https://emberwalk.app/terms");
    expect(text.endsWith(FOOTER)).toBe(true);
  });

  it("writes it in Spanish when the plan owner's walks are in Spanish", async () => {
    const { deps, mails } = setup();
    await livePlan(deps);
    await seedWalk("11111111-1111-4111-8111-111111111111", "done");
    await env.DB.prepare("UPDATE walks SET language = 'es' WHERE visitor_id = ?").bind(VISITOR).run();
    await deliver(deps, send());
    const text = mails[0]?.body.text ?? "";
    expect(mails[0]?.body.subject).toBe("Su plan de EmberWalk se renueva el 31 de octubre de 2026");
    expect(text).toContain("se renueva automáticamente el 31 de octubre de 2026 a menos que usted lo cancele antes");
    expect(text).toContain("$12.99");
    expect(text).toContain(`Para cancelar, abra este enlace e ingrese el correo de su plan: ${PORTAL}`);
    expect(text.endsWith(FOOTER)).toBe(true);
  });

  it("sends the same stable cancel link to a plan bought on a phone, whoever is signed in", async () => {
    const { deps, mails } = setup();
    await livePlan(deps);
    await env.DB.prepare("UPDATE plans SET visitor_id = ? WHERE customer_id = ?").bind("c".repeat(64), CUSTOMER).run();
    await deliver(deps, send());
    expect(mails[0]?.body.text).toContain(PORTAL);
    expect(mails[0]?.body.text).not.toContain("#/plan");
  });

  it("sends once for a repeated webhook, and keys the mail by the subscription and the renewal date for the mail service", async () => {
    const { deps, mails } = setup();
    await livePlan(deps);
    await deliver(deps, send("evt_up"));
    expect((await deliver(deps, send("evt_up"))).body).toEqual({ received: true, duplicate: true });
    expect(mails).toHaveLength(1);
    await deliver(deps, send("evt_up_again"));
    expect(mails).toHaveLength(2);
    expect(mails[0]?.headers.get("idempotency-key")).toBe(`renewal-${SUBSCRIPTION}-${RENEWS_ON}`);
    expect(mails[1]?.headers.get("idempotency-key")).toBe(mails[0]?.headers.get("idempotency-key"));
  });

  it("sends nothing for a plan that is cancelled or refunded, for no plan at all, or for an invoice with no email address", async () => {
    const { deps, mails } = setup();
    await deliver(deps, send("evt_none"));
    await livePlan(deps);
    await deliver(deps, send("evt_noemail", { customer_email: null }));
    await deliver(deps, JSON.stringify(event("evt_d", "customer.subscription.deleted", T0 + 5, subscription("canceled", RENEWS))));
    await deliver(deps, send("evt_cancelled"));
    expect(mails).toEqual([]);
  });

  it("sends nothing for a plan whose charge was refunded in full", async () => {
    const { deps, mails } = setup();
    await livePlan(deps);
    await deliver(deps, JSON.stringify(event("evt_ref", "charge.refunded", T0 + 600, charge())));
    expect((await deliver(deps, send("evt_after_refund"))).status).toBe(200);
    expect(mails).toEqual([]);
  });

  it("sends nothing for another subscription than the plan's", async () => {
    const { deps, mails } = setup();
    await livePlan(deps);
    await deliver(deps, send("evt_other", { parent: { type: "subscription_details", subscription_details: { subscription: "sub_1MowQVLkdIwHu7ixOtherOne1" } } }));
    expect(mails).toEqual([]);
  });

  it("sends nothing for a subscription that already ends at its period end, and asks Stripe only for that one subscription", async () => {
    const { deps, mails, stripe } = setup();
    await livePlan(deps);
    stripe.cancelAtPeriodEnd = true;
    expect((await deliver(deps, send())).status).toBe(200);
    expect(mails).toEqual([]);
    expect(stripe.looked).toEqual([`/v1/subscriptions/${SUBSCRIPTION}`]);
  });

  it("warns, and still sends, when the event comes less than 15 days before the renewal", async () => {
    const { deps, mails, logs } = setup();
    await livePlan(deps);
    await deliver(deps, send("evt_late", {}, RENEWS - 10 * 86400));
    expect(mails).toHaveLength(1);
    expect(logs.join("\n")).toMatch(/renewal notice .* only 10 days before/);
    const quiet = setup();
    await env.DB.batch(["plans", "stripe_events"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    await livePlan(quiet.deps);
    await deliver(quiet.deps, send("evt_on_time"));
    expect(quiet.logs.join("\n")).not.toContain("days before");
  });

  describe("a notice that can never be sent is logged and recorded, so Stripe does not send it again", () => {
    it.each([
      ["an address that is not an address", { customer_email: "not an address" }, () => Response.json({ id: "mail_1" })],
      ["an invoice that is not an invoice", { amount_due: "a lot" }, () => Response.json({ id: "mail_1" })],
    ])("for %s", async (_name, over, answer) => {
      const { deps, mails, logs } = setup({}, answer);
      await livePlan(deps);
      expect((await deliver(deps, send("evt_bad", over))).body).toEqual({ received: true, duplicate: false });
      expect(mails).toEqual([]);
      expect(logs.join("\n")).toContain("renewal notice");
      expect((await deliver(deps, send("evt_bad", over))).body).toEqual({ received: true, duplicate: true });
    });

    it("for a mail service that refuses it with a 4xx", async () => {
      const { deps, mails, logs } = setup({}, () => Response.json({ message: "invalid" }, { status: 422 }));
      await livePlan(deps);
      expect((await deliver(deps, send())).body).toEqual({ received: true, duplicate: false });
      expect(mails).toHaveLength(1);
      expect(logs.join("\n")).toContain("refused");
      expect((await deliver(deps, send())).body).toEqual({ received: true, duplicate: true });
    });
  });

  describe("a notice that may go later answers an error, so Stripe sends the event again", () => {
    it("while the mail service is down, and sends then", async () => {
      let up = false;
      const { deps, mails, logs } = setup({}, () => (up ? Response.json({ id: "mail_2" }) : Response.json({ message: "down" }, { status: 503 })));
      await livePlan(deps);
      expect((await deliver(deps, send())).status).toBe(500);
      expect(logs.join("\n")).toContain("renewal");
      up = true;
      expect((await deliver(deps, send())).body).toEqual({ received: true, duplicate: false });
      expect(mails).toHaveLength(2);
    });

    it.each([401, 403])("while the mail service turns our key away with a %s, our setup fault, and sends once it is fixed", async (status) => {
      let fixed = false;
      const { deps, mails, logs } = setup({}, () => (fixed ? Response.json({ id: "mail_3" }) : Response.json({ message: "no" }, { status })));
      await livePlan(deps);
      expect((await deliver(deps, send())).status).toBe(500);
      expect(logs.join("\n")).toContain("key_rejected");
      fixed = true;
      expect((await deliver(deps, send())).body).toEqual({ received: true, duplicate: false });
      expect(mails).toHaveLength(2);
    });

    it("while the mail service cannot be reached", async () => {
      const { deps } = setup({}, () => new Error("network down"));
      await livePlan(deps);
      expect((await deliver(deps, send())).status).toBe(500);
    });

    it("when mail, the footer or the cancel link is not set up, with nothing sent", async () => {
      const complete = { apiKey: "re_test", portalLoginUrl: PORTAL, footer: FOOTER };
      for (const mail of [undefined, { ...complete, apiKey: undefined }, { ...complete, footer: undefined }, { ...complete, portalLoginUrl: undefined }, { ...complete, portalLoginUrl: "http://not-https.test/login" }]) {
        await env.DB.batch(["plans", "stripe_events"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
        const { deps, mails } = setup({ mail });
        await livePlan(deps);
        expect((await deliver(deps, send())).status).toBe(500);
        expect(mails).toEqual([]);
      }
    });
  });
});
