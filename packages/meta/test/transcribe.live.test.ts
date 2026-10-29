import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MetaClient } from "../src/client.ts";
import { MemoryCache, MemoryLedger } from "../src/stores.ts";
import { readWav, transcribe } from "../src/transcribe.ts";
import { fetchTransport } from "../src/transport.ts";
import { META_BASE_URL, metaKey, REPO, requireLive } from "./live/env.ts";

const SPEECH = path.join(REPO, "fixtures/meta/transcribe-speech.wav");

describe("live Muse Voice Transcribe on a synthetic speech WAV", () => {
  it("reads timed turns and books whole seconds", async () => {
    requireLive();
    if (!existsSync(SPEECH)) throw new Error(`${SPEECH} is missing: the speech clip must have its rights confirmed before it is used`);
    const wav = new Uint8Array(readFileSync(SPEECH));
    const ledger = new MemoryLedger();
    const client = new MetaClient({ transport: fetchTransport({ baseUrl: META_BASE_URL, apiKey: metaKey() }), cache: new MemoryCache(), ledger, billing: "free_credits" });
    const out = await transcribe(client, { wav, walkId: null, content: "synthetic", language: "en" });
    expect(out.value.length).toBeGreaterThan(0);
    for (const t of out.value) expect(t.end).toBeGreaterThanOrEqual(t.start);
    expect(ledger.entries.map((e) => [e.step, e.units.kind, e.units.count])).toEqual([["transcribe", "seconds", Math.floor(readWav(wav).seconds)]]);
  });
});
