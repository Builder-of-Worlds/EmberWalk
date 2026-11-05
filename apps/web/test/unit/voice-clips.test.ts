import { describe, expect, it } from "vitest";
import { CARTESIA_URL, makeClips, sentencesToVoice } from "../../build/voice-clips.ts";
import { sentenceKey } from "../../src/voice.ts";

const MP3 = new Uint8Array([0x49, 0x44, 0x33]);

const run = (over: { status?: number; have?: Record<string, string> } = {}) => {
  const asked: { url: string; headers: Record<string, string>; body: { transcript: string; voice: { id: string }; output_format: { container: string } } }[] = [];
  const written: { name: string; bytes: number }[] = [];
  const work = makeClips({
    sentences: ["One sentence.", "Two sentences."],
    apiKey: "test-key",
    voiceId: "stock-voice",
    have: over.have ?? {},
    fetch: async (url, init) => {
      asked.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response(MP3, { status: over.status ?? 200 });
    },
    write: async (name, bytes) => void written.push({ name, bytes: bytes.length }),
  });
  return { work, asked, written };
};

describe("making the voice clips", () => {
  it("asks Cartesia for each sentence by its own words, and maps the sentence to the file it wrote", async () => {
    const { work, asked, written } = run();
    const clips = await work;
    expect(asked.map((a) => a.url)).toEqual([CARTESIA_URL, CARTESIA_URL]);
    expect(asked[0]?.body).toMatchObject({ transcript: "One sentence.", voice: { id: "stock-voice" }, output_format: { container: "mp3" } });
    expect(asked[0]?.headers.authorization).toBe("Bearer test-key");
    expect(Object.keys(clips).sort()).toEqual([sentenceKey("One sentence."), sentenceKey("Two sentences.")].sort());
    expect(written.map((w) => w.name).sort()).toEqual(Object.values(clips).sort());
    expect(written[0]?.bytes).toBe(MP3.length);
  });

  it("pays for no sentence it already has", async () => {
    const have = { [sentenceKey("One sentence.")]: "voice/old.mp3" };
    const { work, asked } = run({ have });
    const clips = await work;
    expect(asked.map((a) => a.body.transcript)).toEqual(["Two sentences."]);
    expect(clips[sentenceKey("One sentence.")]).toBe("voice/old.mp3");
  });

  it("stops on a refusal and writes nothing for it", async () => {
    const { work, written } = run({ status: 402 });
    await expect(work).rejects.toThrow("402");
    expect(written).toEqual([]);
  });

  it("voices every sentence of the rule table and the samples, once each", () => {
    const sentences = sentencesToVoice();
    expect(sentences.length).toBeGreaterThan(10);
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(sentences).toContain("Stack the firewood at least 30 feet from the house, or keep it completely covered with sheet metal.");
  });
});
