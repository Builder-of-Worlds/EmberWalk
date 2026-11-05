import { env } from "cloudflare:workers";
import { BILLING_PATHS, limitsFromConfig, limitsWith, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { clearWalks } from "./seed.ts";
import { CUSTOMER, EXTRA_PRICE, LANDLORD_PRICE, PRICE, VISITOR } from "./stripe-shapes.ts";

const deployed = { ...env, EMBERWALK_LIMITS: env.DEPLOYED_LIMITS, STRIPE_PRICE_INDIVIDUAL: PRICE, STRIPE_PRICE_LANDLORD: LANDLORD_PRICE, STRIPE_PRICE_EXTRA_WALK: EXTRA_PRICE };

const send = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://go.emberwalk.app${path}`, { ...init, headers: { [VISITOR_HEADER]: VISITOR } }) as never, deployed as never);

const walkBody = JSON.stringify({ language: "en", jurisdiction: "us_ca", device: { camera: "rear", width: 1080, height: 1920 }, synthetic: false, visitorId: VISITOR });

const realWalks = async () => (await env.DB.prepare("SELECT count(*) AS n FROM walks WHERE synthetic = 0").first<{ n: number }>())?.n;

beforeEach(async () => {
  await clearWalks();
  await env.DB.batch(["plans", "extra_walks", "refunded_charges"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

describe("payments on in the API Worker's own config", () => {
  it("reads paymentsOn true and every other limit at its default", () => {
    expect(limitsFromConfig(deployed.EMBERWALK_LIMITS)).toEqual(limitsWith({ paymentsOn: true }));
  });

  it("answers the plan route with the offers instead of not open", async () => {
    const response = await send(BILLING_PATHS.plan);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plan: { status: string }; offers: unknown[] };
    expect(body.plan.status).toBe("none");
    expect(body.offers).toHaveLength(2);
  });

  it("asks for a plan before a walk, stores none, and starts it once the plan holds", async () => {
    const refused = await send("/api/walks", { method: "POST", body: walkBody });
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("plan_needed");
    expect(await realWalks()).toBe(0);
    await env.DB.prepare("INSERT INTO plans (customer_id, visitor_id, status, price_id, period_start, event_at) VALUES (?, ?, 'active', ?, '2026-01-01T00:00:00.000Z', 1)").bind(CUSTOMER, VISITOR, PRICE).run();
    expect((await send("/api/walks", { method: "POST", body: walkBody })).status).toBe(200);
    expect(await realWalks()).toBe(1);
  });
});
