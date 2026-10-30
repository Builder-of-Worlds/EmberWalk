import { type HttpRequest, SPARK_OPEN_MODEL } from "@emberwalk/meta";
import { RULES } from "@emberwalk/rules";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { basetenFor, type Deps, depsFrom } from "../src/deps.ts";
import type { Env } from "../src/env.ts";
import { secondCheckKey } from "@emberwalk/shared";
import { SecondCheckRecord, secondCheckWalk } from "../src/second-check-step.ts";
import { resetAll, spentNano } from "./fixtures.ts";
import { harness, testDeps } from "./harness.ts";
import { clientOn, json, scripted, seedFindings, sentJson, stillBytes } from "./writing-seed.ts";

const listed = (ids: string[] = [SPARK_OPEN_MODEL]) => json(200, { object: "list", data: ids.map((id) => ({ id, object: "model" })) });
const verdict = (args: object) =>
  json(200, {
    model: SPARK_OPEN_MODEL,
    choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "check_instruction", arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 2000, completion_tokens: 100 },
  });
const AGREES = { verdict: "agrees", reason: "Dead brush within 30 feet must go." };
const FLAGS = { verdict: "flags", reason: "The rule asks for 30 feet, not 5." };

const baseten = (answer: (req: HttpRequest, n: number) => ReturnType<typeof json>) => {
  let n = 0;
  return scripted((req) => (req.method === "GET" && req.path === "/models" ? listed() : answer(req, ++n)));
};

const withBaseten = (fake: ReturnType<typeof scripted> | null, realWalks = false, billing: "paid" | "free_credits" = "free_credits"): Deps => ({
  ...testDeps(env, harness),
  baseten: () => (fake === null ? null : { client: clientOn(fake.transport, billing), transport: fake.transport }),
  secondCheckRealWalks: realWalks,
});

const record = async (walkId: string) => {
  const object = await env.MEDIA.get(secondCheckKey(walkId));
  return object === null ? null : SecondCheckRecord.parse(await object.json());
};

const chats = (fake: ReturnType<typeof scripted>) => fake.requests.filter((r) => r.path === "/chat/completions");

describe("secondCheckWalk", () => {
  beforeEach(resetAll);

  it("checks every kept instruction with its rule and blurred still and stores each verdict", async () => {
    const { walkId, findings } = await seedFindings(4, { vetoRank: 3 });
    const fake = baseten((_req, n) => verdict(n === 2 ? FLAGS : AGREES));

    expect(await secondCheckWalk(withBaseten(fake), walkId)).toEqual({ checked: 3, failed: 0, skipped: null });

    const kept = [findings[0]!, findings[1]!, findings[3]!];
    expect(fake.requests[0]).toMatchObject({ method: "GET", path: "/models" });
    expect(chats(fake)).toHaveLength(3);
    const rule = RULES.find((r) => r.id === "ca-dry-brush-ccr-z1")!;
    const [text, image] = (sentJson(chats(fake)[0]).messages as { content: unknown }[])[1]?.content as [{ text: string }, { image_url: { url: string } }];
    expect(JSON.parse(text.text)).toMatchObject({ found: "dry_brush", instruction: kept[0]!.instruction, rules: [{ citation: rule.citation, words: rule.requirement }] });
    expect(image.image_url.url).toBe(`data:image/jpeg;base64,${btoa(String.fromCharCode(...stillBytes(1)))}`);
    expect(await record(walkId)).toEqual({ [kept[0]!.id]: AGREES, [kept[1]!.id]: FLAGS, [kept[2]!.id]: AGREES });
    expect(await spentNano()).toBe(3 * (2000 * 1250 + 100 * 4250));
  });

  it("keeps real walks off unless the switch is on, and sends nothing", async () => {
    const { walkId } = await seedFindings(2, { synthetic: false });
    const fake = baseten(() => verdict(AGREES));

    expect(await secondCheckWalk(withBaseten(fake), walkId)).toEqual({ checked: 0, failed: 0, skipped: "real_walk" });
    expect(fake.requests).toEqual([]);
    expect(await record(walkId)).toBeNull();
  });

  it("checks a real walk once the switch is on and billing is paid", async () => {
    const { walkId } = await seedFindings(2, { synthetic: false });
    const fake = baseten(() => verdict(AGREES));

    expect(await secondCheckWalk(withBaseten(fake, true, "paid"), walkId)).toEqual({ checked: 2, failed: 0, skipped: null });
  });

  it("still refuses a real walk on free credits with the switch on", async () => {
    const { walkId } = await seedFindings(1, { synthetic: false });
    const fake = baseten(() => verdict(AGREES));

    expect(await secondCheckWalk(withBaseten(fake, true), walkId)).toEqual({ checked: 0, failed: 1, skipped: null });
    expect(chats(fake)).toEqual([]);
  });

  it("skips when Baseten is not set up or does not serve the model", async () => {
    const { walkId } = await seedFindings(1);
    expect(await secondCheckWalk(withBaseten(null), walkId)).toEqual({ checked: 0, failed: 0, skipped: "not_set_up" });
    const other = scripted(() => listed(["meta-models/something-else"]));
    expect(await secondCheckWalk(withBaseten(other), walkId)).toEqual({ checked: 0, failed: 0, skipped: "model_not_listed" });
    expect(chats(other)).toEqual([]);
  });

  it("retries a timed out check, and keeps going past one that never answers well", async () => {
    const { walkId, findings } = await seedFindings(2);
    const fake = baseten((_req, n) => (n === 1 ? json(504, {}) : n <= 4 ? json(200, { choices: [{ message: { content: "no idea" } }] }) : verdict(AGREES)));

    expect(await secondCheckWalk(withBaseten(fake), walkId)).toEqual({ checked: 1, failed: 1, skipped: null });
    expect(chats(fake)).toHaveLength(5);
    expect(harness.sleeps.length).toBeGreaterThan(0);
    expect(await record(walkId)).toEqual({ [findings[1]!.id]: AGREES });
  });

  it("stops checking once its time is spent, counting the model check, and keeps the verdicts already made", async () => {
    const { walkId, findings } = await seedFindings(3);
    let clock = 0;
    const fake = baseten(() => ((clock += 1000), verdict(AGREES)));

    expect(await secondCheckWalk(withBaseten(fake), walkId, 2000, () => clock)).toEqual({ checked: 2, failed: 0, skipped: null });
    expect(chats(fake)).toHaveLength(2);
    expect(Object.keys((await record(walkId)) ?? {})).toEqual([findings[0]!.id, findings[1]!.id]);

    const slow = await seedFindings(1);
    clock = 0;
    const slowList = scripted((req) => (req.path === "/models" ? ((clock += 2000), listed()) : verdict(AGREES)));
    expect(await secondCheckWalk(withBaseten(slowList), slow.walkId, 2000, () => clock)).toEqual({ checked: 0, failed: 0, skipped: null });
    expect(chats(slowList)).toEqual([]);
  });

  it("starts no check four minutes in, well inside the step's fifteen", async () => {
    const { walkId } = await seedFindings(3);
    let clock = 0;
    const fake = baseten(() => ((clock += 120_000), verdict(AGREES)));

    expect(await secondCheckWalk(withBaseten(fake), walkId, undefined, () => clock)).toEqual({ checked: 2, failed: 0, skipped: null });
  });

  it("stores nothing when no check succeeds, and never throws", async () => {
    const { walkId } = await seedFindings(1, { noStillRank: 1 });
    const fake = baseten(() => verdict(AGREES));
    expect(await secondCheckWalk(withBaseten(fake), walkId)).toEqual({ checked: 0, failed: 1, skipped: null });
    expect(chats(fake)).toEqual([]);
    expect(await record(walkId)).toBeNull();
    expect(await secondCheckWalk(withBaseten(fake), "00000000-0000-4000-8000-00000000dead")).toEqual({ checked: 0, failed: 1, skipped: null });
  });

  it("does nothing for a walk with no kept findings", async () => {
    const { walkId } = await seedFindings(1, { vetoRank: 1 });
    const fake = baseten(() => verdict(AGREES));
    expect(await secondCheckWalk(withBaseten(fake), walkId)).toEqual({ checked: 0, failed: 0, skipped: null });
    expect(fake.requests).toEqual([]);
  });
});

describe("basetenFor", () => {
  it("builds no client without a key, and one that sends to Baseten with it", () => {
    const base: Env = { ...(env as unknown as Env) };
    delete base.BASETEN_API_KEY;
    expect(basetenFor(base)).toBeNull();
    expect(basetenFor({ ...base, BASETEN_API_KEY: "" })).toBeNull();
    expect(basetenFor({ ...base, BASETEN_API_KEY: "test-key" })).not.toBeNull();
  });

  it("bills as paid only when the Meta billing says paid", () => {
    const keyed: Env = { ...(env as unknown as Env), BASETEN_API_KEY: "test-key" };
    const billing = (value: string) => basetenFor({ ...keyed, META_BILLING: value })!.client.billing;
    expect(billing("paid")).toBe("paid");
    expect([billing("free_credits"), billing(""), billing("PAID")]).toEqual(["free_credits", "free_credits", "free_credits"]);
  });
});

describe("the SECOND_CHECK_REAL_WALKS switch", () => {
  it("is on only for exactly on", () => {
    const flag = (value: string | undefined) => {
      const base = env as unknown as Env;
      expect(base.SECOND_CHECK_REAL_WALKS).toBeUndefined();
      return depsFrom(value === undefined ? base : { ...base, SECOND_CHECK_REAL_WALKS: value }).secondCheckRealWalks;
    };
    expect(flag("on")).toBe(true);
    expect([flag("off"), flag(undefined), flag("ON"), flag("yes")]).toEqual([false, false, false, false]);
  });

  it("keeps a real walk off when the switch was never given", async () => {
    const { walkId } = await seedFindings(1, { synthetic: false });
    const fake = baseten(() => verdict(AGREES));
    const deps: Deps = { ...withBaseten(fake, true, "paid") };
    delete deps.secondCheckRealWalks;

    expect(await secondCheckWalk(deps, walkId)).toEqual({ checked: 0, failed: 0, skipped: "real_walk" });
    expect(fake.requests).toEqual([]);
  });
});
