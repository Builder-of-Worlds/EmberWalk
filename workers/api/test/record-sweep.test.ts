import { env } from "cloudflare:workers";
import { DELETE_EVERYTHING_PATH, limitsWith, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleDeleteEverything } from "../src/delete-everything.ts";
import { sweepAccounts, sweepRecords } from "../src/record-sweep.ts";
import { allKeys, gid, keysHolding, OTHER, rowsHolding, run, seedBoth, tables, W1, W2, W5, WB } from "./erase-seed.ts";
import { emptyBucket } from "./route.ts";
import { OWNER, seedWalk } from "./seed.ts";

const NOW = new Date("2027-11-05T12:00:00.000Z");
const A_DAY_OVER = "2026-11-04T12:00:00.000Z";
const A_DAY_UNDER = "2026-11-06T12:00:00.000Z";
const TWO_YEARS_BACK = "2025-09-05T12:00:00.000Z";

const age = (visitor: string, at: string) => run("UPDATE walks SET created_at = ? WHERE visitor_id = ?", at, visitor);

const plan = (customer: string, visitor: string, status: string, renewsAt: string | null) =>
  run("INSERT INTO plans (customer_id, visitor_id, subscription_id, status, renews_at, event_at) VALUES (?, ?, ?, ?, ?, 9)", `cus_${customer}`, visitor, `sub_${customer}`, status, renewsAt);

const reset = async (): Promise<void> => {
  await run("DELETE FROM walks");
  for (const table of ["get_it_fixed_uses", "fault_reports", "cost_records", "cache_entries", "plans", "sign_in_links", "accounts"]) await run(`DELETE FROM ${table}`);
  await emptyBucket();
};

const everything = async (): Promise<{ rows: string[]; keys: string[] }> => {
  const rows: string[] = [];
  for (const table of await tables()) {
    for (const row of (await env.DB.prepare(`SELECT * FROM "${table}"`).all()).results) rows.push(`${table} ${JSON.stringify(row)}`);
  }
  return { rows: rows.sort(), keys: await allKeys() };
};

const deleteEverything = async (visitor: string): Promise<number> =>
  (
    await handleDeleteEverything(
      new Request(`https://api.test${DELETE_EVERYTHING_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", [VISITOR_HEADER]: visitor },
        body: JSON.stringify({ visitorId: visitor }),
      }),
      { db: env.DB, bucket: env.MEDIA, limits: limitsWith({ deleteEverythingOn: true }), now: () => NOW.getTime() },
    )
  ).status;

const sweep = () => sweepRecords({ DB: env.DB, MEDIA: env.MEDIA }, NOW);

describe("account sweep", () => {
  const ACCOUNT = "a1000000-0000-4000-8000-000000000001";
  const OWNER_ID = "9".repeat(64);
  const EMAIL = "owner@example.com";
  const HASH = "7".repeat(64);
  const seedAccount = async (at = TWO_YEARS_BACK) => {
    await run("INSERT INTO accounts (id, email, created_at, owner_id) VALUES (?, ?, ?, ?)", ACCOUNT, EMAIL, at, OWNER_ID);
    await run(
      "INSERT INTO sign_in_links (token_hash, email, visitor_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      HASH,
      EMAIL,
      OWNER,
      at,
      new Date(Date.parse(at) + 900_000).toISOString(),
    );
  };
  const seedSession = (visitor: string, at: string) =>
    run("INSERT INTO sessions (token_hash, account_id, visitor_id, created_at, expires_at, same_phone) VALUES (?, ?, ?, ?, ?, 1)", "8".repeat(64), ACCOUNT, visitor, at, new Date(Date.parse(at) + 86_400_000).toISOString());
  const walkOf = (id: string, visitor: string, at: string) =>
    run("INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, created_at) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1920, 1080, ?)", id, visitor, at);
  const left = async () => ({
    accounts: (await env.DB.prepare("SELECT count(*) AS n FROM accounts").first<{ n: number }>())?.n,
    links: (await env.DB.prepare("SELECT count(*) AS n FROM sign_in_links").first<{ n: number }>())?.n,
  });
  const sweepBoth = async () => {
    await sweep();
    return sweepAccounts({ DB: env.DB, MEDIA: env.MEDIA }, NOW);
  };

  beforeEach(reset);

  it("removes an account and its links 12 months after its last walk, plan or session", async () => {
    await seedAccount();
    await seedSession(OWNER, TWO_YEARS_BACK);
    expect(await sweepBoth()).toMatchObject({ accounts: 1 });
    expect(await left()).toEqual({ accounts: 0, links: 0 });
  });

  it("erases an old walk under the owner id, then the account, in one run", async () => {
    await seedAccount();
    await walkOf(W1, OWNER_ID, TWO_YEARS_BACK);
    await sweepBoth();
    expect(await left()).toEqual({ accounts: 0, links: 0 });
  });

  it("keeps an account with a walk under the owner id inside 12 months", async () => {
    await seedAccount();
    await walkOf(W1, OWNER_ID, A_DAY_UNDER);
    expect(await sweepBoth()).toMatchObject({ accounts: 0 });
    expect((await left()).accounts).toBe(1);
  });

  it("keeps an account whose signed in phone walked inside 12 months", async () => {
    await seedAccount();
    await seedSession(OWNER, TWO_YEARS_BACK);
    await walkOf(W1, OWNER, A_DAY_UNDER);
    await sweepBoth();
    expect((await left()).accounts).toBe(1);
  });

  it("keeps an account in use: a session inside 12 months counts, on the phone that asked or any other", async () => {
    await seedAccount();
    await seedSession(OWNER, A_DAY_UNDER);
    await sweepBoth();
    expect((await left()).accounts).toBe(1);
    await run("UPDATE sessions SET same_phone = 0");
    await sweepBoth();
    expect((await left()).accounts).toBe(1);
  });

  it("removes the account once its last session is over 12 months old too", async () => {
    await seedAccount();
    await seedSession(OWNER, A_DAY_OVER);
    await run("UPDATE sessions SET same_phone = 0");
    await sweepBoth();
    expect((await left()).accounts).toBe(0);
  });

  it("keeps an account made inside 12 months", async () => {
    await seedAccount(A_DAY_UNDER);
    await sweepBoth();
    expect(await left()).toEqual({ accounts: 1, links: 1 });
  });

  it("keeps an account whose plan is running, and removes it once the plan ended over 12 months ago, unlinking the plan", async () => {
    await seedAccount();
    await plan("own", OWNER_ID, "active", null);
    await sweepBoth();
    expect((await left()).accounts).toBe(1);
    await run("UPDATE plans SET status = 'canceled', renews_at = ?", A_DAY_OVER);
    await sweepBoth();
    expect((await left()).accounts).toBe(0);
    expect((await env.DB.prepare("SELECT visitor_id FROM plans").first<{ visitor_id: string | null }>())?.visitor_id).toBeNull();
  });

  it("keeps a manager whose property had a walk inside 12 months", async () => {
    await seedAccount();
    const PORTFOLIO = "a2000000-0000-4000-8000-000000000001";
    const PROPERTY = "a3000000-0000-4000-8000-000000000001";
    await run("INSERT INTO portfolios (id, account_id, created_at) VALUES (?, ?, ?)", PORTFOLIO, ACCOUNT, TWO_YEARS_BACK);
    await run("INSERT INTO properties (id, portfolio_id, label, created_at) VALUES (?, ?, 'Home', ?)", PROPERTY, PORTFOLIO, TWO_YEARS_BACK);
    await walkOf(W1, OTHER, A_DAY_UNDER);
    await run("INSERT INTO property_walks (walk_id, property_id, linked_at) VALUES (?, ?, ?)", W1, PROPERTY, A_DAY_UNDER);
    await sweepBoth();
    expect((await left()).accounts).toBe(1);
  });

  it("removes link rows over 12 months old even with no account, and leaves younger ones", async () => {
    await seedAccount(A_DAY_UNDER);
    await run("INSERT INTO sign_in_links (token_hash, email, visitor_id, created_at, expires_at) VALUES (?, 'never@example.com', ?, ?, ?)", "6".repeat(64), OTHER, A_DAY_OVER, "2026-11-04T12:15:00.000Z");
    expect(await sweepBoth()).toMatchObject({ links: 1 });
    expect((await left()).links).toBe(1);
  });
});

describe("record sweep", () => {
  beforeEach(reset);

  it("erases a visitor whose last walk is 12 months and a day old, and nobody else", async () => {
    const { mine, theirs } = await seedBoth();
    await age(OWNER, A_DAY_OVER);
    await age(OTHER, A_DAY_UNDER);
    const before = { rows: await rowsHolding(theirs), keys: await keysHolding(theirs) };

    expect(await sweep()).toEqual({ visitors: 1, walks: 3, busy: 0, failed: 0 });

    expect(await rowsHolding(mine)).toEqual([]);
    expect(await keysHolding(mine)).toEqual([]);
    expect({ rows: await rowsHolding(theirs), keys: await keysHolding(theirs) }).toEqual(before);
    expect(await sweep()).toEqual({ visitors: 0, walks: 0, busy: 0, failed: 0 });
  });

  it("keeps a visitor whose last walk is 12 months less a day old", async () => {
    const { mine } = await seedBoth();
    await age(OWNER, A_DAY_UNDER);
    await age(OTHER, A_DAY_UNDER);
    const before = await everything();

    expect(await sweep()).toEqual({ visitors: 0, walks: 0, busy: 0, failed: 0 });

    expect(await everything()).toEqual(before);
    expect((await rowsHolding(mine)).length).toBeGreaterThan(0);
  });

  it("goes by the latest walk: one recent walk keeps all the older ones", async () => {
    const { mine } = await seedBoth();
    await age(OWNER, TWO_YEARS_BACK);
    await age(OTHER, TWO_YEARS_BACK);
    await run("UPDATE walks SET created_at = ? WHERE id = ?", A_DAY_UNDER, W2);
    const before = await rowsHolding(mine);

    expect(await sweep()).toEqual({ visitors: 1, walks: 1, busy: 0, failed: 0 });

    expect(await rowsHolding(mine)).toEqual(before);
    expect(await rowsHolding([OTHER, WB])).toEqual([]);
  });

  it("keeps records until 12 months after the plan ended when that is later than the last walk", async () => {
    const { mine } = await seedBoth();
    await age(OWNER, TWO_YEARS_BACK);
    await age(OTHER, A_DAY_UNDER);
    await plan("a", OWNER, "canceled", A_DAY_UNDER);
    const before = await rowsHolding(mine);

    expect(await sweep()).toEqual({ visitors: 0, walks: 0, busy: 0, failed: 0 });
    expect(await rowsHolding(mine)).toEqual(before);

    await run("UPDATE plans SET renews_at = ? WHERE customer_id = 'cus_a'", A_DAY_OVER);
    expect(await sweep()).toEqual({ visitors: 1, walks: 3, busy: 0, failed: 0 });
    expect(await rowsHolding(mine)).toEqual([]);
  });

  it("uses the latest of several plans, and ignores a plan that was never paid", async () => {
    const { mine } = await seedBoth();
    await age(OWNER, TWO_YEARS_BACK);
    await age(OTHER, A_DAY_UNDER);
    await plan("old", OWNER, "canceled", A_DAY_OVER);
    await plan("never", OWNER, "incomplete", A_DAY_UNDER);
    expect(await sweep()).toEqual({ visitors: 1, walks: 3, busy: 0, failed: 0 });
    expect(await rowsHolding(mine)).toEqual([]);
  });

  it("keeps a visitor whose plan is still running", async () => {
    await seedBoth();
    await age(OWNER, TWO_YEARS_BACK);
    await age(OTHER, A_DAY_UNDER);
    await plan("live", OWNER, "active", "2027-12-05T12:00:00.000Z");
    expect(await sweep()).toEqual({ visitors: 0, walks: 0, busy: 0, failed: 0 });
  });

  it("treats a running plan with no end date as running, and an ended one by when it last changed", async () => {
    const { mine } = await seedBoth();
    await age(OWNER, TWO_YEARS_BACK);
    await age(OTHER, A_DAY_UNDER);
    await plan("live", OWNER, "active", null);
    await run("UPDATE plans SET updated_at = ? WHERE customer_id = 'cus_live'", A_DAY_OVER);
    expect(await sweep()).toEqual({ visitors: 0, walks: 0, busy: 0, failed: 0 });

    await run("UPDATE plans SET status = 'canceled', updated_at = ? WHERE customer_id = 'cus_live'", A_DAY_UNDER);
    expect(await sweep()).toEqual({ visitors: 0, walks: 0, busy: 0, failed: 0 });

    await run("UPDATE plans SET updated_at = ? WHERE customer_id = 'cus_live'", A_DAY_OVER);
    expect(await sweep()).toEqual({ visitors: 1, walks: 3, busy: 0, failed: 0 });
    expect(await rowsHolding(mine)).toEqual([]);
  });

  it("reaches the phones behind 25 that are always busy", async () => {
    await seedBoth();
    for (let n = 1; n <= 25; n++) {
      await run(
        "INSERT INTO walks (id, visitor_id, created_at, state, step, language, jurisdiction, device_camera, device_width, device_height) VALUES (?, ?, ?, 'processing', 'prepare', 'en', 'us_ca', 'rear', 1920, 1080)",
        gid("22", n),
        n.toString(16).padStart(64, "0"),
        TWO_YEARS_BACK,
      );
    }
    await age(OWNER, A_DAY_OVER);
    await age(OTHER, A_DAY_OVER);

    expect(await sweep()).toEqual({ visitors: 2, walks: 4, busy: 25, failed: 0 });
    expect(await rowsHolding([OWNER, OTHER])).toEqual([]);
  });

  // Seeds and erases two visitors twice and reads every table twice: under 1 s alone, over 3 s under the gate's load.
  it("removes exactly what Delete Everything removes", async () => {
    await seedBoth();
    await age(OWNER, A_DAY_OVER);
    await age(OTHER, A_DAY_UNDER);
    expect(await deleteEverything(OWNER)).toBe(200);
    const byHand = await everything();

    await reset();
    await seedBoth();
    await age(OWNER, A_DAY_OVER);
    await age(OTHER, A_DAY_UNDER);
    await sweep();

    expect(await everything()).toEqual(byHand);
    expect(byHand.rows.length).toBeGreaterThan(0);
  }, 30_000);

  it("leaves a visitor with a walk still being checked for a later run", async () => {
    await seedBoth();
    await seedWalk(W5, "processing", "segment");
    await age(OWNER, A_DAY_OVER);
    await age(OTHER, A_DAY_OVER);
    const owner = await rowsHolding([OWNER]);

    expect(await sweep()).toEqual({ visitors: 1, walks: 1, busy: 1, failed: 0 });

    expect(await rowsHolding([OWNER])).toEqual(owner);
    expect(await rowsHolding([OTHER, WB])).toEqual([]);
  });

  it("goes on to the next visitor when one cannot be erased", async () => {
    await seedBoth();
    await age(OWNER, A_DAY_OVER);
    await age(OTHER, A_DAY_OVER);
    const broken = new Proxy(env.MEDIA, {
      get(target, name) {
        if (name === "delete") {
          return (keys: string | string[]) => {
            if ([keys].flat().some((key) => key.includes(W1))) throw new Error("storage is down");
            return target.delete(keys);
          };
        }
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    expect(await sweepRecords({ DB: env.DB, MEDIA: broken }, NOW)).toEqual({ visitors: 1, walks: 1, busy: 0, failed: 1 });

    expect(await rowsHolding([OTHER, WB])).toEqual([]);
    expect(await sweep()).toEqual({ visitors: 1, walks: 2, busy: 0, failed: 0 });
    expect(await rowsHolding([OWNER])).toEqual([]);
  });
});
