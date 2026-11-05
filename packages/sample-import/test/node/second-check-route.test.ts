import { confirmModel, secondCheckRequest, type Transport } from "@emberwalk/meta";
import { describe, expect, it } from "vitest";
import { secondCheckTally, secondCheckTransport } from "../../src/live/second-check-route.ts";
import { sampleOf } from "../../src/live/sample-fixture.ts";

const live: Transport = async () => {
  throw new Error("the live route was called");
};
const connect = (apiKey: string): Transport => {
  connected.push(apiKey);
  return live;
};
const connected: string[] = [];

const FINDING = { concept: "dry_brush", band: "zone_1" as const, distanceFeet: { low: 10, high: 20 }, label: "required_now" as const, instruction: "Clear it.", rules: [], photo: "data:image/jpeg;base64,AA==" };

describe("the runner's route to the second check", () => {
  it("stays off without the flag, even with a key", () => {
    expect(secondCheckTransport({ wanted: false, fake: false, apiKey: "k", connect })).toBeNull();
  });

  it("refuses a live run that asks for it with no key, so it cannot end without saying so", () => {
    expect(() => secondCheckTransport({ wanted: true, fake: false, apiKey: "", connect })).toThrow(/BASETEN_API_KEY/);
  });

  it("connects with the key on a live run", () => {
    expect(secondCheckTransport({ wanted: true, fake: false, apiKey: "the-key", connect })).toBe(live);
    expect(connected).toContain("the-key");
  });

  it("answers the model list and one verdict on fake answers, with no key and no connection", async () => {
    const before = connected.length;
    const transport = secondCheckTransport({ wanted: true, fake: true, apiKey: "", connect });
    expect(transport).not.toBeNull();
    await confirmModel(transport as Transport);
    const call = secondCheckRequest(FINDING, { content: "synthetic", walkId: null });
    const answer = await (transport as Transport)(call.request);
    expect(call.read(JSON.parse(answer.text))).toMatchObject({ verdict: "agrees" });
    expect(connected.length).toBe(before);
  });
});

describe("the tally of second checks on a finished run", () => {
  it("counts checked and flagged findings out of all of them", () => {
    const findings = [{ secondCheck: { verdict: "agrees" } }, { secondCheck: { verdict: "flags" } }, { secondCheck: null }, {}];
    expect(secondCheckTally(findings)).toEqual({ checked: 2, flagged: 1, of: 4 });
  });
});

describe("the sample made from a run", () => {
  it("keeps each finding's second check", () => {
    const secondCheck = { verdict: "flags" as const, reason: "The rule asks for 30 feet." };
    const run = { id: "r", synthetic: true, findings: [{ id: "f", preview: null, proof: { still: "s" }, secondCheck }] };
    expect(sampleOf(run, "sample", { f: "1-f.jpg" }, new Set()).findings[0]?.secondCheck).toEqual(secondCheck);
  });
});
