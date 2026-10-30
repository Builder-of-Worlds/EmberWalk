import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixPrompt, museImageEditCall } from "../src/image.ts";
import { MUSE_IMAGE_MODEL } from "../src/prices.ts";
import { fetchTransport } from "../src/transport.ts";
import { META_BASE_URL, metaKey, requireLive } from "./live/env.ts";
import { dryBrushPhoto, LOGS, liveClient, record } from "./live/m4.ts";

describe("live Muse Image See It Fixed on the second test yard's dry brush", () => {
  requireLive();
  const { client, cache, ledger } = liveClient(fetchTransport({ baseUrl: META_BASE_URL, apiKey: metaKey() }));

  afterAll(() => record("191-muse-image", cache, ledger));

  it("returns one edited jpeg for one cent", async () => {
    const instruction = "Clear the dry brush from the first 5 feet around the house and keep that ground bare.";
    const a = await client.call(museImageEditCall({ prompt: fixPrompt("dry_brush", instruction), image: dryBrushPhoto(), content: "synthetic", walkId: null }));
    const bytes = Buffer.from(a.value.base64, "base64");
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(a.costUsd).toBe(0.01);
    expect(ledger.entries.map((e) => [e.model, e.step, e.units.kind, e.units.count])).toEqual([[MUSE_IMAGE_MODEL, "preview", "images", 1]]);
    mkdirSync(LOGS, { recursive: true });
    writeFileSync(path.join(LOGS, "191-muse-image-dry-brush.jpg"), bytes);
  }, 180_000);
});
