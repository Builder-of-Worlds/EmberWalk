import { describe, expect, it } from "vitest";
import type { MetaRefused } from "../src/errors.ts";
import { SPARK_OPEN_MODEL } from "../src/prices.ts";
import { checkInstruction, secondCheck, secondCheckRequest } from "../src/second-check.ts";
import { ok, setup } from "./support.ts";

const finding = {
  concept: "wood_pile",
  band: "zone_0" as const,
  distanceFeet: { low: 0, high: 2 },
  label: "required_now" as const,
  instruction: "Move the firewood at least 30 feet from the house.",
  rules: [{ citation: "14 CCR 1299.03(a)", words: "Remove combustible materials within 5 feet." }],
  photo: "data:image/jpeg;base64,/9j/4AAQ",
};
const opts = { content: "synthetic" as const, walkId: "00000000-0000-4000-8000-000000000001", realWalks: false, sleep: async () => {} };
const usage = { prompt_tokens: 2000, completion_tokens: 300 };
const tool = (args: string) => ({ choices: [{ message: { tool_calls: [{ id: "c1", type: "function", function: { name: "check_instruction", arguments: args } }] } }], usage });
const reason = (e: unknown) => (e as MetaRefused).reason;

describe("secondCheck", () => {
  it("sends the finding, its rule and its photo to Muse Spark Open and returns the verdict", async () => {
    const { client, transport } = setup({ answer: () => ok(tool('{"verdict":"agrees","reason":"The firewood is against the wall."}')) });
    expect(await secondCheck(client, finding, opts)).toEqual({ verdict: "agrees", reason: "The firewood is against the wall." });
    const json = (transport.requests[0] as unknown as { json: { model: string; max_tokens: number; messages: { role: string; content: unknown }[] } }).json;
    expect(json.model).toBe(SPARK_OPEN_MODEL);
    expect(json.max_tokens).toBe(2048);
    expect(json.messages[0]?.role).toBe("system");
    const [text, image] = json.messages[1]?.content as [{ text: string }, { image_url: { url: string } }];
    expect(JSON.parse(text.text)).toEqual({ found: "wood_pile", band: "zone_0", distanceFeet: { low: 0, high: 2 }, label: "required_now", rules: finding.rules, instruction: finding.instruction });
    expect(image.image_url.url).toBe(finding.photo);
  });

  it("reserves 3000 input tokens and the 2048 token output cap for each check", () => {
    expect(secondCheckRequest(finding, opts).estimateNano).toBe(3000 * 1250 + 2048 * 4250);
  });

  it("keeps a flag and its reason", async () => {
    const { client } = setup({ answer: () => ok(tool('{"verdict":"flags","reason":"The rule asks for 5 feet, not 30."}')) });
    expect(await secondCheck(client, finding, opts)).toEqual({ verdict: "flags", reason: "The rule asks for 5 feet, not 30." });
  });

  it("asks again after an unusable answer, then takes the good one", async () => {
    const answers = [ok({ choices: [{ message: { content: "" } }], usage }), ok(tool('{"verdict":"agrees","reason":"Fine."}'))];
    const { client, transport } = setup({ answer: () => answers.shift()! });
    expect((await secondCheck(client, finding, opts)).verdict).toBe("agrees");
    expect(transport.requests).toHaveLength(2);
  });

  it("refuses an answer that calls the tool twice", async () => {
    const twice = { choices: [{ message: { tool_calls: [1, 2].map((n) => ({ id: `c${n}`, type: "function", function: { name: "check_instruction", arguments: '{"verdict":"agrees","reason":"Fine."}' } })) } }], usage };
    const { client, transport } = setup({ answer: () => ok(twice) });
    const { client: c2, cache } = setup({ answer: () => ok(twice) });
    expect(await secondCheck(c2, finding, opts).catch(reason)).toBe("invalid_tool_arguments");
    expect(cache.entries.size).toBe(0);
    expect(await secondCheck(client, finding, opts).catch(reason)).toBe("invalid_tool_arguments");
    expect(transport.requests).toHaveLength(3);
  });

  it("keeps real walks off unless the switch is on", async () => {
    const { client, transport } = setup({ answer: () => ok(tool('{"verdict":"agrees","reason":"Fine."}')), billing: "paid" });
    expect(await secondCheck(client, finding, { ...opts, content: "real" }).catch(reason)).toBe("real_walk_off_second_check");
    expect(transport.requests).toHaveLength(0);
    expect((await secondCheck(client, finding, { ...opts, content: "real", realWalks: true })).verdict).toBe("agrees");
  });

  it("offers only the check_instruction tool, whose arguments are the shared verdict", () => {
    const json = secondCheckRequest(finding, opts).request.json as { tools: { function: { name: string } }[] };
    expect(json.tools.map((t) => t.function.name)).toEqual(["check_instruction"]);
    expect(checkInstruction.args.safeParse({ verdict: "agrees", reason: "Fine.", extra: 1 }).success).toBe(false);
  });
});
