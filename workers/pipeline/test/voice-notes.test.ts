import type { Turn } from "@emberwalk/meta";
import type { Clip, Finding, Tag, Track } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CLEAN_PHRASE, cleanNotes, cutAtWord, matchTurns, findingSpans, MAX_NOTE, type Span } from "../src/voice-notes.ts";
import { resetAll } from "./fixtures.ts";
import { harness, idFor, testDeps } from "./harness.ts";

beforeEach(resetAll);

const turn = (start: number, end: number, text: string): Turn => ({ start, end, text });
const span = (n: number, start: number, end: number, rank = n): Span => ({ findingId: idFor(n), rank, start, end });

describe("matchTurns", () => {
  it("puts a turn on the finding it overlaps most", () => {
    const notes = matchTurns([turn(10, 14, "The pile is against the wall.")], [span(1, 8, 11), span(2, 11, 20)]);
    expect(notes).toEqual([{ findingId: idFor(2), text: "The pile is against the wall." }]);
  });

  it("puts a turn near no finding's frames on the nearest within 5 seconds", () => {
    const notes = matchTurns([turn(30, 32, "That juniper is dead inside.")], [span(1, 0, 10), span(2, 35, 40)]);
    expect(notes).toEqual([{ findingId: idFor(2), text: "That juniper is dead inside." }]);
  });

  it("joins two turns on one finding in time order with one space", () => {
    const notes = matchTurns([turn(6, 7, "second part."), turn(2, 3, "First part,")], [span(1, 0, 10)]);
    expect(notes).toEqual([{ findingId: idFor(1), text: "First part, second part." }]);
  });

  it("gives a tie to the better rank", () => {
    const notes = matchTurns([turn(10, 12, "Both are here.")], [span(1, 9, 13, 2), span(2, 9, 13, 1)]);
    expect(notes).toEqual([{ findingId: idFor(2), text: "Both are here." }]);
  });

  it("gives a turn equally near two findings to the better rank", () => {
    const notes = matchTurns([turn(10, 11, "Between them.")], [span(1, 0, 8, 1), span(2, 13, 20, 2)]);
    expect(notes).toEqual([{ findingId: idFor(1), text: "Between them." }]);
  });

  it("drops a turn 5.1 seconds from every finding", () => {
    expect(matchTurns([turn(15.1, 16, "Nothing near.")], [span(1, 0, 10), span(2, 21.1, 30)])).toEqual([]);
  });

  it("keeps a turn exactly 5 seconds away", () => {
    expect(matchTurns([turn(15, 16, "Just near.")], [span(1, 0, 10)])).toHaveLength(1);
  });

  it("cuts a 3,000 character note at a word to 2,000 characters or fewer", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    const [note] = matchTurns([turn(1, 2, words)], [span(1, 0, 10)]);
    expect(words.length).toBeGreaterThan(3000);
    expect(note?.text.length).toBeLessThanOrEqual(MAX_NOTE);
    expect(note?.text.length).toBeGreaterThan(MAX_NOTE - 10);
    expect(words.startsWith(`${note?.text} `)).toBe(true);
  });

  it("gives no notes for no turns or no findings", () => {
    expect(matchTurns([], [span(1, 0, 10)])).toEqual([]);
    expect(matchTurns([turn(1, 2, "Hello.")], [])).toEqual([]);
  });
});

describe("cutAtWord", () => {
  it("keeps a short note whole and hard cuts one long word", () => {
    expect(cutAtWord("short note")).toBe("short note");
    expect(cutAtWord("x".repeat(2500))).toHaveLength(MAX_NOTE);
    expect(cutAtWord(` ${"x".repeat(2500)}`)).toHaveLength(MAX_NOTE);
  });
});

describe("findingSpans", () => {
  it("runs from a finding's tracks' first to last frame in walk seconds", () => {
    const walkId = idFor(900);
    const clip: Clip = { id: idFor(901), walkId, kind: "pan", file: `clips/${walkId}/pan.mp4`, fps: 2, frameCount: 60, width: 320, height: 334 };
    const tag: Tag = { id: idFor(902), walkId, kind: "pan", startSeconds: 50, endSeconds: 80, label: "back", samples: [{ t: 50, tiltDegrees: 0, headingDegrees: 0 }], propertyLine: null };
    const frames = (ns: number[]) => ns.map((frame) => ({ frame, box: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number], mask: null, confidence: 0.9 }));
    const tracks: Track[] = [
      { id: idFor(903), clipId: clip.id, concept: "shrub", samObjectId: 0, frames: frames([4, 6]) },
      { id: idFor(904), clipId: clip.id, concept: "shrub", samObjectId: 1, frames: frames([10]) },
    ];
    const found = { id: idFor(905), rank: 3, trackIds: [idFor(903), idFor(904)] } as Finding;
    const tapped = { id: idFor(906), rank: 1, trackIds: [] as string[] } as Finding;
    expect(findingSpans([found, tapped], tracks, [clip], [tag])).toEqual([{ findingId: idFor(905), rank: 3, start: 52, end: 55 }]);
  });
});

describe("cleanNotes", () => {
  const raw = [
    { findingId: idFor(1), text: "um the wood pile is like right up against the garage wall" },
    { findingId: idFor(2), text: "uh that juniper got lots of dead branches in it" },
  ];
  const deps = () => testDeps(env, harness);
  const stage = (notes: { id: string; text: string }[]) => {
    harness.answers[CLEAN_PHRASE] = [{ text: JSON.stringify({ notes }) }];
  };
  const sparkCalls = () => harness.requests.filter((r) => r.path === "/responses").length;

  it("stores the cleaned words with punctuation and capitals fixed", async () => {
    stage([
      { id: "1", text: "The wood pile is right up against the garage wall." },
      { id: "2", text: "That juniper has lots of dead branches in it." },
    ]);
    expect(await cleanNotes(deps(), idFor(50), raw, "synthetic")).toEqual([
      { findingId: idFor(1), text: "The wood pile is right up against the garage wall." },
      { findingId: idFor(2), text: "That juniper has lots of dead branches in it." },
    ]);
    expect(sparkCalls()).toBe(1);
  });

  it("sends every note of the walk in one call", async () => {
    stage([]);
    await cleanNotes(deps(), idFor(50), raw, "synthetic");
    const sent = harness.requests.find((r) => r.path === "/responses");
    const body = JSON.stringify(sent && "json" in sent ? sent.json : null);
    expect(body).toContain("garage wall");
    expect(body).toContain("juniper");
  });

  it.each([
    ["empty", ""],
    ["over long", `${"Long. ".repeat(400)}`],
    ["too short", "Wood pile."],
  ])("stores the raw words when the cleaned answer is %s", async (_name, text) => {
    stage([
      { id: "1", text },
      { id: "2", text: "That juniper has lots of dead branches in it." },
    ]);
    const notes = await cleanNotes(deps(), idFor(50), raw, "synthetic");
    expect(notes[0]).toEqual(raw[0]);
    expect(notes[1]?.text).toBe("That juniper has lots of dead branches in it.");
  });

  it("stores the raw words for a note the answer leaves out", async () => {
    stage([{ id: "2", text: "That juniper has lots of dead branches in it." }]);
    expect((await cleanNotes(deps(), idFor(50), raw, "synthetic"))[0]).toEqual(raw[0]);
  });

  it("stores the raw words when the answer is not JSON", async () => {
    harness.answers[CLEAN_PHRASE] = [{ text: "Sure! Here are your notes." }];
    expect(await cleanNotes(deps(), idFor(50), raw, "synthetic")).toEqual(raw);
  });

  it("stores the raw words when the call keeps failing, after retrying", async () => {
    harness.answers[CLEAN_PHRASE] = [{ status: 500 }];
    expect(await cleanNotes(deps(), idFor(50), raw, "synthetic")).toEqual(raw);
    expect(sparkCalls()).toBe(3);
  });

  it("makes no Spark call for real content on free credits and stores the raw words", async () => {
    expect(await cleanNotes(deps(), idFor(50), raw, "real")).toEqual(raw);
    expect(sparkCalls()).toBe(0);
  });

  it("makes no call when there are no notes", async () => {
    expect(await cleanNotes(deps(), idFor(50), [], "synthetic")).toEqual([]);
    expect(sparkCalls()).toBe(0);
  });
});
