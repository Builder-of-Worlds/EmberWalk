import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copy, longDate } from "../../src/copy.ts";
import { feetSaid } from "../../src/distance.ts";
import { marksKey } from "../../src/finding-marks.ts";
import { removedByYou } from "../../src/results.ts";
import type { WalkResults } from "../../src/results.ts";
import { findingFor, resultsFor, ROUTES } from "../../src/router.ts";
import { fakeClock, memoryMarks, memoryStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { feet, finding, walk } from "./result-fakes.ts";
import { NEVER_LABELLED, NEVER_SAID, SETTLED_FINDING, SETTLED_RESULTS, SETTLED_STATUS, shownLines } from "./settled.ts";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const go = async (hash: string) =>
  settle(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

const open = async (results: WalkResults, findingId: string, over: Parameters<typeof testDeps>[0] = {}) => {
  window.location.hash = findingFor(results.id, findingId);
  const deps = testDeps({ results: async (id) => (id === results.id ? results : null), ...over });
  const view = await render(<App deps={deps} />);
  await until(() => view.host.querySelector("main.one-finding") !== null);
  return { ...view, deps };
};

const pick = async (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no button "${label}"`);
  await settle(() => button.click());
};

const has = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].some((b) => b.textContent === label);

const listedIds = (host: HTMLElement) =>
  [...host.querySelectorAll("li.finding a")].map((a) => a.getAttribute("href"));

const RECOMMENDED = finding("rec", {
  label: "recommended",
  band: "zone_2",
  ...feet(40),
  instruction: "Thin the shrubs under the oak.",
  sources: [
    { citation: "Guide A", words: "keep shrubs apart", status: "recommended", url: "https://example.org/a", retrievedOn: "2026-10-25" },
    { citation: "Guide B", words: "space the plants", status: "recommended", url: "https://example.org/b", retrievedOn: "2026-10-25" },
  ],
});

const REQUIRED = finding("req", { band: "zone_0", ...feet(2), instruction: "Move the wood pile." });

afterEach(() => {
  window.location.hash = "";
});

describe("Finding, step 10", () => {
  it("shows only settled lines and the finding's own words, with no synthetic label on a sample house", async () => {
    const results = walk([RECOMMENDED, REQUIRED], [], { synthetic: true });
    const view = await open(results, RECOMMENDED.id);
    await pick(view.host, copy.finding.more);
    await pick(view.host, copy.finding.notRight);
    await pick(view.host, copy.finding.more);
    await pick(view.host, copy.finding.more);
    const allowed = new Set([...SETTLED_RESULTS, ...SETTLED_FINDING, ...SETTLED_STATUS, RECOMMENDED.instruction, ...RECOMMENDED.sources.flatMap((s) => [s.citation, s.words])]);
    for (const line of shownLines(view.host)) expect(allowed, line).toContain(line);
    expect(view.text()).not.toMatch(NEVER_LABELLED);
    for (const word of NEVER_SAID) expect(view.text().toLowerCase()).not.toContain(word);
    await view.unmount();
  });

  it("shows only settled lines and the finding's own words on a walked house too, in both views", async () => {
    const results = walk([RECOMMENDED, REQUIRED], [], { synthetic: false });
    const view = await open(results, RECOMMENDED.id);
    for (const chosen of [copy.results.detailed, copy.results.simple]) {
      await pick(view.host, chosen);
      const allowed = new Set([...SETTLED_RESULTS, ...SETTLED_FINDING, ...SETTLED_STATUS, copy.results.distance(feetSaid(RECOMMENDED.distanceFeet)), RECOMMENDED.instruction, ...RECOMMENDED.sources.flatMap((s) => [s.citation, s.words])]);
      for (const line of shownLines(view.host)) expect(allowed, line).toContain(line);
    }
    await view.unmount();
  });

  it("shows the proof photo with its marker, the label and the sentence", async () => {
    const view = await open(walk([REQUIRED]), REQUIRED.id);
    expect(view.host.querySelector(".proof img")?.getAttribute("src")).toBe(REQUIRED.proof.still);
    const marker = view.host.querySelector<HTMLElement>(".proof .marker");
    expect([marker?.style.left, marker?.style.top, marker?.style.width, marker?.style.height]).toEqual(["10%", "20%", "40%", "40%"]);
    expect(view.host.querySelector("p.label")?.textContent).toBe(copy.results.label.required_now);
    expect(view.host.querySelector("p.sentence")?.textContent).toBe(REQUIRED.instruction);
    expect(view.text()).not.toMatch(NEVER_LABELLED);
    await view.unmount();
  });

  it("never says required on a Recommended finding, More open or closed", async () => {
    const view = await open(walk([RECOMMENDED]), RECOMMENDED.id);
    expect(view.host.querySelector("p.label")?.textContent).toBe(copy.results.label.recommended);
    expect(view.text().toLowerCase()).not.toContain("required");
    await pick(view.host, copy.finding.more);
    expect(view.text().toLowerCase()).not.toContain("required");
    await view.unmount();
  });

  it("opens More on Where This Comes From, each source linked to its page with its words", async () => {
    const view = await open(walk([RECOMMENDED]), RECOMMENDED.id);
    const toggle = [...view.host.querySelectorAll("button")].find((b) => b.textContent === copy.finding.more);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(view.host.querySelector("#more")).toBeNull();
    expect(has(view.host, copy.finding.notRight)).toBe(false);
    await pick(view.host, copy.finding.more);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(view.host.querySelector("#more h2")?.textContent).toBe(copy.finding.source);
    const sources = [...view.host.querySelectorAll(".sources li")].map((li) => ({
      citation: li.querySelector("a")?.textContent,
      url: li.querySelector("a")?.getAttribute("href"),
      words: li.querySelector("q")?.textContent,
    }));
    expect(sources).toEqual(RECOMMENDED.sources.map(({ citation, url, words }) => ({ citation, url, words })));
    await pick(view.host, copy.finding.more);
    expect(view.host.querySelector("#more")).toBeNull();
    await view.unmount();
  });

  it("removes the item with This Isn't Right and brings it back with Undo, kept on the phone", async () => {
    const storage = memoryStorage();
    const { clock } = fakeClock(5_000);
    const results = walk([REQUIRED, RECOMMENDED]);
    const view = await open(results, REQUIRED.id, { marks: memoryMarks(storage), clock });
    expect(view.host.querySelector("[role=status]")).toBeNull();
    await pick(view.host, copy.finding.more);
    await pick(view.host, copy.finding.notRight);
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.finding.removed);
    expect(has(view.host, copy.finding.notRight)).toBe(false);
    expect(memoryMarks(storage).removed(results.id)).toEqual([{ findingId: REQUIRED.id, atMs: 5_000 }]);
    expect(removedByYou(results, memoryMarks(storage).removed(results.id))).toEqual([{ ...REQUIRED, removedAtMs: 5_000 }]);
    await view.unmount();

    const back = await open(results, REQUIRED.id, { marks: memoryMarks(storage) });
    expect(back.host.querySelector("[role=status]")?.textContent).toBe(copy.finding.removed);
    await pick(back.host, copy.finding.undo);
    expect(back.host.querySelector("[role=status]")).toBeNull();
    expect(memoryMarks(storage).removed(results.id)).toEqual([]);
    await pick(back.host, copy.finding.more);
    expect(has(back.host, copy.finding.notRight)).toBe(true);
    await back.unmount();
  });

  it("drops a removed item from the Results list and verdict, and Undo puts it back", async () => {
    const results = walk([REQUIRED, RECOMMENDED]);
    const view = await open(results, REQUIRED.id);
    await pick(view.host, copy.finding.more);
    await pick(view.host, copy.finding.notRight);
    await go(resultsFor(results.id));
    await until(() => view.host.querySelector("h1") !== null);
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.results.ready);
    expect(listedIds(view.host)).toEqual([findingFor(results.id, RECOMMENDED.id)]);

    await go(findingFor(results.id, REQUIRED.id));
    await until(() => view.host.querySelector("main.one-finding") !== null);
    await pick(view.host, copy.finding.undo);
    await go(resultsFor(results.id));
    await until(() => view.host.querySelector("h1") !== null);
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.results.fixFirst(1));
    expect(listedIds(view.host)).toContain(findingFor(results.id, REQUIRED.id));
    await view.unmount();
  });

  it("each results row links to its own finding", async () => {
    const results = walk([REQUIRED, RECOMMENDED]);
    window.location.hash = resultsFor(results.id);
    const view = await render(<App deps={testDeps({ results: async (id) => (id === results.id ? results : null) })} />);
    await until(() => view.host.querySelector("h1") !== null);
    expect(new Set(listedIds(view.host))).toEqual(new Set([findingFor(results.id, REQUIRED.id), findingFor(results.id, RECOMMENDED.id)]));
    await view.unmount();
  });

  it("sends an unknown finding to its results, and unknown results home", async () => {
    const results = walk([REQUIRED]);
    window.location.hash = findingFor(results.id, "gone");
    const lost = await render(<App deps={testDeps({ results: async (id) => (id === results.id ? results : null) })} />);
    await until(() => window.location.hash === resultsFor(results.id));
    expect(lost.host.querySelector("main.one-finding")).toBeNull();
    await lost.unmount();

    window.location.hash = findingFor("nowhere", REQUIRED.id);
    const none = await render(<App deps={testDeps({ results: async () => null })} />);
    await until(() => window.location.hash === ROUTES.home || window.location.hash === "");
    expect(none.host.querySelector("main.one-finding")).toBeNull();
    await none.unmount();

    window.location.hash = ROUTES.finding;
    const bare = await render(<App deps={testDeps({ results: async () => results })} />);
    await until(() => window.location.hash === ROUTES.home || window.location.hash === "");
    expect(bare.host.querySelector("main.one-finding")).toBeNull();
    await bare.unmount();
  });
});

const pressed = (host: HTMLElement) =>
  [...host.querySelectorAll(".statuses button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);

const status = (host: HTMLElement) => host.querySelector(".status-picker [data-part=status]")?.getAttribute("data-status");

const typeNote = async (host: HTMLElement, text: string) => {
  const input = host.querySelector<HTMLInputElement>("#note")!;
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("Finding status", () => {
  it("starts at Needs Fixing with no note field", async () => {
    const view = await open(walk([REQUIRED]), REQUIRED.id);
    expect(pressed(view.host)).toEqual([copy.status.kind.needs_fixing]);
    expect(status(view.host)).toBe("needs_fixing");
    expect(view.host.querySelector("#note")).toBeNull();
    await view.unmount();
  });

  it("Fix Planned offers an optional note with its example, saves it, and keeps it after a reload", async () => {
    const storage = memoryStorage();
    const results = walk([REQUIRED]);
    const view = await open(results, REQUIRED.id, { marks: memoryMarks(storage) });
    await pick(view.host, copy.status.kind.fix_planned);
    expect(pressed(view.host)).toEqual([copy.status.kind.fix_planned]);
    expect(view.host.querySelector("label[for=note]")?.textContent).toBe(copy.status.note);
    expect(view.host.querySelector("#note")?.getAttribute("placeholder")).toBe(copy.status.example);
    expect(memoryMarks(storage).statusOf(results.id, REQUIRED.id)).toEqual({ kind: "fix_planned", note: "", recheck: null });
    await typeNote(view.host, " Tree crew Saturday. ");
    await pick(view.host, copy.status.save);
    expect(view.host.querySelector(".note q")?.textContent).toBe("Tree crew Saturday.");
    await view.unmount();

    const again = await open(results, REQUIRED.id, { marks: memoryMarks(storage) });
    expect(pressed(again.host)).toEqual([copy.status.kind.fix_planned]);
    expect(again.host.querySelector<HTMLInputElement>("#note")?.value).toBe("Tree crew Saturday.");
    expect(again.host.querySelector(".note q")?.textContent).toBe("Tree crew Saturday.");
    await again.unmount();
  });

  it("Done says not rechecked yet and never Rechecked, and the walk stays short of green", async () => {
    const results = walk([REQUIRED]);
    const view = await open(results, REQUIRED.id);
    await pick(view.host, copy.status.kind.done);
    await pick(view.host, copy.status.save);
    expect(pressed(view.host)).toEqual([copy.status.kind.done]);
    expect(status(view.host)).toBe("done");
    expect(view.text()).toContain(copy.status.notRechecked);
    expect(view.text()).not.toContain(copy.status.rechecked);
    expect(view.host.querySelector("#note")).toBeNull();
    await go(resultsFor(results.id));
    await until(() => view.host.querySelector("h1") !== null);
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.results.fixFirst(1));
    expect(view.host.querySelector("li.finding [data-part=status]")?.getAttribute("data-status")).toBe("done");
    await view.unmount();
  });

  it("shows Rechecked with its date only for a Done item with a recheck photo, and choosing another status drops it", async () => {
    const storage = memoryStorage();
    const atMs = Date.UTC(2026, 10, 2, 12);
    storage.setItem(marksKey("walk-1"), JSON.stringify({ removed: {}, status: { req: { kind: "done", recheck: { photo: "r.jpg", atMs } } } }));
    const view = await open(walk([REQUIRED]), REQUIRED.id, { marks: memoryMarks(storage) });
    expect(status(view.host)).toBe("rechecked");
    expect(view.text()).toContain(copy.status.rechecked);
    expect(view.host.querySelector(".status-picker time")?.textContent).toBe(longDate(new Date(atMs)));
    expect(pressed(view.host)).toEqual([copy.status.kind.done]);
    await pick(view.host, copy.status.kind.done);
    await pick(view.host, copy.status.save);
    expect(status(view.host)).toBe("rechecked");
    await pick(view.host, copy.status.kind.needs_fixing);
    await pick(view.host, copy.status.kind.done);
    await pick(view.host, copy.status.save);
    expect(status(view.host)).toBe("done");
    expect(view.text()).not.toContain(copy.status.rechecked);
    await view.unmount();
  });

  it("hides the status while the item is removed", async () => {
    const view = await open(walk([REQUIRED]), REQUIRED.id);
    await pick(view.host, copy.finding.more);
    await pick(view.host, copy.finding.notRight);
    expect(view.host.querySelector(".status-picker")).toBeNull();
    await pick(view.host, copy.finding.undo);
    expect(pressed(view.host)).toEqual([copy.status.kind.needs_fixing]);
    await view.unmount();
  });
});

describe("What You Said", () => {
  const NOTE = "This woodpile is right up against the garage wall. I meant to move it last spring.";

  const moreOrder = (host: HTMLElement) =>
    [...(host.querySelector("#more")?.children ?? [])].map((el) => (el.tagName === "H2" || el.tagName === "BUTTON" ? el.textContent : el.className));

  it("shows the note under its heading in More, after the sources and before This Isn't Right", async () => {
    const view = await open(walk([finding("said", { voiceNote: NOTE })]), "said");
    expect(view.text()).not.toContain(NOTE);
    await pick(view.host, copy.finding.more);
    expect(copy.finding.said).toBe("What You Said");
    expect(moreOrder(view.host)).toEqual([copy.finding.source, "sources", copy.finding.said, "said", copy.finding.notRight]);
    expect(view.host.querySelector("#more p.said")?.textContent).toBe(NOTE);
    expect(view.host.querySelector("#more audio, #more [aria-label*='play' i]")).toBeNull();
    await view.unmount();
  });

  it.each([
    ["null", { voiceNote: null }],
    ["missing, as in a bundled sample or an older kept copy", {}],
    ["blank", { voiceNote: "  \n " }],
  ])("shows no heading and no empty block when the note is %s", async (_, over) => {
    const view = await open(walk([finding("quiet", over)]), "quiet");
    await pick(view.host, copy.finding.more);
    expect(moreOrder(view.host)).toEqual([copy.finding.source, "sources", copy.finding.notRight]);
    expect(view.text()).not.toContain(copy.finding.said);
    await view.unmount();
  });

  it("renders the words as text, never as markup", async () => {
    const said = `<b>loud</b> <img src=x onerror="alert(1)"> & more`;
    const view = await open(walk([finding("markup", { voiceNote: said })]), "markup");
    await pick(view.host, copy.finding.more);
    const shown = view.host.querySelector("#more p.said");
    expect(shown?.textContent).toBe(said);
    expect(shown?.children.length).toBe(0);
    await view.unmount();
  });

  it("keeps the note on a removed item and adds nothing else to it", async () => {
    const view = await open(walk([finding("gone", { voiceNote: NOTE })]), "gone");
    await pick(view.host, copy.finding.more);
    await pick(view.host, copy.finding.notRight);
    expect(moreOrder(view.host)).toEqual([copy.finding.source, "sources", copy.finding.said, "said"]);
    await view.unmount();
  });
});
