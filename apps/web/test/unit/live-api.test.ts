import { IDBFactory } from "fake-indexeddb";
import { stillPath, VISITOR_HEADER } from "@emberwalk/shared";
import { describe, expect, it, vi } from "vitest";
import { walkApi } from "../../src/api.ts";
import type { Fetch } from "../../src/api.ts";
import { apiResults, apiStills, isLiveStill, samplesThenApi } from "../../src/live-api.ts";
import { keptResults, openResultsStore } from "../../src/results-store.ts";
import { verdictOf } from "../../src/results.ts";
import { SAMPLES, sampleResults } from "../../src/samples.ts";
import { fakeClock } from "./fakes.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "./result-fakes.ts";

const BASE = "https://ember.test";
const VISITOR = "b".repeat(64);

const serving = (answer: () => Response | Promise<Response>) => {
  const seen: Request[] = [];
  const send: Fetch = async (request) => {
    seen.push(request);
    return answer();
  };
  return { seen, walks: walkApi(BASE, send, () => VISITOR) };
};

const refusal = (code: string, status: number) => Response.json({ error: { code, message: "No." } }, { status });

describe("apiResults", () => {
  it("turns a done walk into the results the screen takes, each still absolute and the walk's synthetic flag kept", async () => {
    const { walks } = serving(() => Response.json(liveBody(LIVE_WALK, 2, { synthetic: true })));
    const results = await apiResults(walks, BASE)(LIVE_WALK);
    expect(results).toMatchObject({ id: LIVE_WALK, walkedOn: "2026-10-27", synthetic: true, coverage: "not_checked", gaps: [], notChecked: ["roof_debris"] });
    expect(results?.findings.map((f) => f.proof.still)).toEqual([1, 2].map((n) => `${BASE}${stillPath(LIVE_WALK, liveFindingId(n))}`));
    expect(results?.findings[0]).toMatchObject({ id: liveFindingId(1), instruction: `Fix ${liveFindingId(1)}.`, sources: [{ status: "in_force" }] });
    expect(verdictOf(results!).kind).toBe("so_far");
  });

  it("brings each side the walk could not check onto the phone, so the results ask for that side", async () => {
    const gaps = [
      { side: "back", kind: "not_checked", hint: "again" },
      { side: "left", kind: "dark", hint: "more_light" },
    ] as const;
    const { walks } = serving(() => Response.json(liveBody(LIVE_WALK, 1, { gaps: [...gaps] })));
    const results = await apiResults(walks, BASE)(LIVE_WALK);
    expect(results?.gaps).toEqual(gaps);
    expect(verdictOf(results!)).toEqual({ kind: "incomplete", gaps });
  });

  it("brings the drawing's pins onto the phone, and reads a body without pins as none", async () => {
    const pins = [{ findingId: liveFindingId(1), side: "back", band: "zone_2", position: 0.4, feet: 40 }] as const;
    const { walks } = serving(() => Response.json(liveBody(LIVE_WALK, 2, { pins: [...pins] })));
    expect((await apiResults(walks, BASE)(LIVE_WALK))?.pins).toEqual(pins);
    const bare = serving(() => Response.json(liveBody(LIVE_WALK, 2)));
    expect((await apiResults(bare.walks, BASE)(LIVE_WALK))?.pins ?? []).toEqual([]);
  });

  it("gives null for a walk that is unknown or not done yet", async () => {
    for (const [code, status] of [["unknown_walk", 404], ["walk_not_done", 409]] as const) {
      const { walks } = serving(() => refusal(code, status));
      expect(await apiResults(walks, BASE)(LIVE_WALK), code).toBeNull();
    }
  });

  it("throws on a body off the contract, a server error, a refusal of the request and no signal", async () => {
    const answers = [
      () => Response.json({ ...liveBody(), gaps: [{ side: "roof", kind: "missing", hint: "walk_side" }] }),
      () => Response.json({ ...liveBody(), gaps: [{ side: "back", kind: "smoke", hint: "walk_side" }] }),
      () => Response.json({ ...liveBody(), walkId: liveFindingId(9) }),
      () => refusal("server_error", 500),
      () => refusal("invalid_request", 400),
      () => Promise.reject(new TypeError("Failed to fetch")),
    ];
    for (const answer of answers) {
      const { walks } = serving(answer);
      await expect(apiResults(walks, BASE)(LIVE_WALK)).rejects.toThrow();
    }
  });
});

describe("samplesThenApi", () => {
  it("opens a bundled sample as checked and never asks the API for it", async () => {
    const api = vi.fn(async () => null);
    const sample = SAMPLES[0]!;
    expect(await samplesThenApi(sampleResults, api)(sample.id)).toEqual({ ...sample, coverage: "checked", notChecked: [] });
    expect(api).not.toHaveBeenCalled();
  });

  it("asks the API for any other id and gives what it gives", async () => {
    const { seen, walks } = serving(() => Response.json(liveBody()));
    const found = await samplesThenApi(sampleResults, apiResults(walks, BASE))(LIVE_WALK);
    expect(found?.coverage).toBe("not_checked");
    expect(seen.map((r) => [r.url, r.headers.get(VISITOR_HEADER)])).toEqual([[`${BASE}/api/walks/${LIVE_WALK}/results`, VISITOR]]);
  });

  it("opens the phone's kept copy when there is no signal", async () => {
    let online = true;
    const { walks } = serving(() => (online ? Response.json(liveBody()) : Promise.reject(new TypeError("Failed to fetch"))));
    const store = openResultsStore(new IDBFactory());
    const load = keptResults(() => store, samplesThenApi(sampleResults, apiResults(walks, BASE)), fakeClock().clock);
    const first = await load(LIVE_WALK);
    online = false;
    expect(await load(LIVE_WALK)).toEqual(first);
    expect(first?.findings).toHaveLength(2);
  });

  it("carries each finding's voice note, and keeps it on the phone for when there is no signal", async () => {
    const body = liveBody();
    body.findings[1]!.voiceNote = "The woodpile is right against the garage.";
    let online = true;
    const { walks } = serving(() => (online ? Response.json(body) : Promise.reject(new TypeError("Failed to fetch"))));
    const store = openResultsStore(new IDBFactory());
    const load = keptResults(() => store, samplesThenApi(sampleResults, apiResults(walks, BASE)), fakeClock().clock);
    expect((await load(LIVE_WALK))?.findings.map((f) => f.voiceNote)).toEqual([null, "The woodpile is right against the garage."]);
    online = false;
    expect((await load(LIVE_WALK))?.findings.map((f) => f.voiceNote)).toEqual([null, "The woodpile is right against the garage."]);
  });

  it("refuses a body whose voice note is over 2,000 characters", async () => {
    const body = liveBody();
    body.findings[0]!.voiceNote = "x".repeat(2001);
    const { walks } = serving(() => Response.json(body));
    await expect(apiResults(walks, BASE)(LIVE_WALK)).rejects.toThrow();
  });
});

describe("live stills", () => {
  it("knows a live still by its API path and leaves a bundled one alone", () => {
    expect(isLiveStill(`${BASE}${stillPath(LIVE_WALK, liveFindingId(1))}`)).toBe(true);
    expect(isLiveStill("/assets/wood-pile-1-abc.jpg")).toBe(false);
    expect(isLiveStill(`${BASE}/api/walks/${LIVE_WALK}/results`)).toBe(false);
    expect(isLiveStill(`${BASE}${stillPath(LIVE_WALK, liveFindingId(1))}/more`)).toBe(false);
  });

  it("fetches a still as this phone's visitor and gives its bytes", async () => {
    const seen: Request[] = [];
    const stills = apiStills(async (request) => {
      seen.push(request);
      return new Response(new Blob(["jpeg"], { type: "image/jpeg" }));
    }, () => VISITOR);
    const url = `${BASE}${stillPath(LIVE_WALK, liveFindingId(1))}`;
    expect(await (await stills(url))?.text()).toBe("jpeg");
    expect(seen.map((r) => [r.method, r.url, r.headers.get(VISITOR_HEADER)])).toEqual([["GET", url, VISITOR]]);
  });

  it("gives null for a refused still, a body that is not a JPEG, and no signal", async () => {
    const url = `${BASE}${stillPath(LIVE_WALK, liveFindingId(1))}`;
    const answers: Fetch[] = [
      async () => refusal("unknown_walk", 404),
      async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
      () => Promise.reject(new TypeError("Failed to fetch")),
    ];
    for (const send of answers) expect(await apiStills(send, () => VISITOR)(url)).toBeNull();
  });
});
