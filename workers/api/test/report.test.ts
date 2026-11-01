import type { ResultFinding } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { type ReportInput, reportHtml, reportOrder, statusOf } from "../src/report.ts";
import { reportWords } from "../src/report-words.ts";
import liveInstructions from "./live-instructions.json" with { type: "json" };

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const finding = (n: number, over: Partial<ResultFinding> = {}): ResultFinding =>
  ({
    id: id(n),
    concept: "dry_brush",
    band: "zone_1",
    distanceFeet: { low: 6, high: 9 },
    label: "required_now",
    instruction: `Clear item ${n}.`,
    sources: [{ citation: "PRC 4291 (a)(1)", words: "Clear flammable vegetation.", status: "in_force", url: "https://example.org/prc-4291", retrievedOn: "2026-10-24" }],
    confidence: 0.8,
    proof: { still: `/api/walks/${id(9)}/stills/${id(n)}`, frame: 1, seconds: 1, marker: [0.1, 0.1, 0.2, 0.2] },
    voiceNote: null,
    ...over,
  }) as ResultFinding;

const input = (over: Partial<ReportInput> = {}, results: Partial<ReportInput["results"]> = {}): ReportInput => ({
  results: { walkedOn: "2026-10-28", findings: [finding(1)], gaps: [], notChecked: [], coverage: "checked", ...results },
  statuses: new Map(),
  marks: [],
  rechecks: [],
  stills: new Map(),
  removed: new Set(),
  approvedAt: null,
  templates: new Map(),
  personal: [],
  ...over,
});

const STILL = "data:image/jpeg;base64,/9j/2w==";

const textIn = (page: string, part: string): string[] => {
  const start = page.indexOf(`<section ${part}>`);
  if (start < 0) return [];
  return [...page.slice(start, page.indexOf("</section>", start)).matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
};

const rowOf = (page: string, findingId: string): string => {
  const start = page.indexOf(`data-finding="${findingId}"`);
  return start < 0 ? "" : page.slice(start, page.indexOf("</li>", start));
};

const sentencesOf = (html: string): string[] =>
  html
    .replace(/<style>.*<\/style>/s, "")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .flatMap((text) => text.split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter((s) => s !== "");

const CLAIMS = /inspect|accept|certif|discount|insur|pass|approv|guarantee|compliant|complies/i;

describe("the report page", () => {
  it("never claims an inspection, acceptance or a discount: the only sentence that names an inspection is the not an inspection line", () => {
    const done = input(
      {
        statuses: new Map([
          [id(1), "done"],
          [id(2), "fix_planned"],
          [id(3), "done"],
        ]),
        marks: [{ findingId: id(1), status: "done", doneOn: "2026-11-01", markedAt: "2026-11-01T10:00:00.000Z" }],
        rechecks: [
          { findingId: id(3), result: "cleared", createdAt: "2026-11-02T10:00:00.000Z" },
          { findingId: id(1), result: "unsure", createdAt: "2026-11-02T11:00:00.000Z" },
        ],
      },
      { findings: [finding(1), finding(2, { band: "zone_0", distanceFeet: { low: 0, high: 2 } }), finding(3, { band: "zone_2", distanceFeet: { low: 40, high: 50 } })] },
    );
    const claims = sentencesOf(reportHtml({ ...done, approvedAt: "2026-11-03T10:00:00.000Z" })).filter((s) => CLAIMS.test(s));
    expect(claims).toEqual([
      "Approved by the homeowner",
      "EmberWalk is not an inspection or certification.",
      "The homeowner checked the blurred photos and approved this record on Nov.",
    ]);
    expect(sentencesOf(reportHtml(done))).toContain("Your local fire agency gives the official sign-off.");
  });

  it("prints both fixed statements on every report: not an inspection or certification, and the Zone 0 rules not yet law", () => {
    for (const page of [reportHtml(input()), reportHtml(input({}, { findings: [] }))]) {
      const start = page.indexOf('data-part="not-inspection"');
      const note = page.slice(start, page.indexOf("</div>", start));
      expect([...note.matchAll(/<p>([^<]*)<\/p>/g)].map((m) => m[1])).toEqual([
        "EmberWalk is not an inspection or certification. Your local fire agency gives the official sign-off.",
        "Distances are approximate.",
        "The Zone 0 rules for the first 5 feet are not yet law.",
      ]);
    }
  });

  it("escapes the photo's alt text that came from the walk", () => {
    const page = reportHtml(input({ stills: new Map([[id(1), STILL]]) }, { findings: [finding(1, { instruction: 'Move the "big" <pile>.' })] }));
    expect(page).toContain(`<img src="${STILL}" alt="Photo from the walk: Move the &quot;big&quot; &lt;pile&gt;.">`);
  });

  it("does not say every side was checked while the walk's coverage is not checked, even with no gap listed", () => {
    const page = reportHtml(input({}, { coverage: "not_checked", gaps: [], notChecked: [] }));
    expect(page).not.toContain(reportWords.allChecked);
  });

  it("names a thing not checked in the app's words for it", () => {
    const page = reportHtml(input({}, { notChecked: ["propane_cylinder", "tree_branch_over_roof"] }));
    expect(textIn(page, 'data-part="coverage"')).toEqual(["Not checked on this walk: small propane cylinders.", "Not checked on this walk: branches over the roof."]);
  });

  it("leaves an item removed with This Isn't Right out of the lists, the count and the record, and lists it under Removed by the homeowner", () => {
    const findings = [finding(1), finding(2, { distanceFeet: { low: 10, high: 12 } })];
    const marks = [{ findingId: id(1), status: "fix_planned" as const, doneOn: null, markedAt: "2026-10-29T10:00:00.000Z" }];
    const page = reportHtml(input({ removed: new Set([id(1)]), marks }, { findings }));
    expect(page).toContain(`<h2>${reportWords.fixFirst(1)}</h2>`);
    expect([...page.matchAll(/class="finding" data-finding="([^"]+)"/g)].map((m) => m[1])).toEqual([id(2)]);
    expect(textIn(page, 'data-part="removed"')).toEqual([reportWords.removedLead, "Dry brush, about 6 to 9 feet from the house."]);
    expect(textIn(page, 'data-part="record"')).toEqual(["Walked Wednesday, October 28th, 2026."]);
    expect(reportHtml(input({}, { findings }))).not.toContain('data-part="removed"');
  });

  it("names the homeowner under Removed by the homeowner, never you, for a reader who is not the homeowner", () => {
    const page = reportHtml(input({ removed: new Set([id(1)]) }, { findings: [finding(1), finding(2)] }));
    const start = page.indexOf('<section data-part="removed">');
    const removed = page.slice(start, page.indexOf("</section>", start));
    expect(removed).toContain("<h2>Removed by the homeowner</h2>");
    expect(removed.replace(/<[^>]+>/g, " ")).not.toMatch(/\byou\b/i);
  });

  it("describes each removed item by what was flagged and where, never by its fix", () => {
    const findings = [
      finding(1, { concept: "wood_pile", distanceFeet: { low: 2, high: 4 }, instruction: "Stack the firewood at least 30 feet from the house." }),
      finding(2),
      finding(3, { concept: "wooden_fence", distanceFeet: { low: 0, high: 3 }, instruction: "Swap the fence for metal." }),
      finding(4, { concept: "shed", distanceFeet: { low: 0, high: 0 }, instruction: "Rake it up and haul it away." }),
    ];
    const page = reportHtml(input({ removed: new Set([id(1), id(3), id(4)]), stills: new Map([[id(1), STILL], [id(3), STILL]]) }, { findings }));
    const start = page.indexOf('<section data-part="removed">');
    const removed = page.slice(start, page.indexOf("</section>", start));
    expect(textIn(page, 'data-part="removed"')).toEqual([
      reportWords.removedLead,
      "Wood piles, about 2 to 4 feet from the house.",
      "Wooden fences, within 3 feet of the house.",
      "Sheds, against the house.",
    ]);
    for (const fix of ["Stack the firewood", "Swap the fence", "Rake it up", "haul it away"]) expect(removed).not.toContain(fix);
    expect([...removed.matchAll(/<img [^>]*alt="([^"]*)"/g)].map((m) => m[1])).toEqual([
      "Photo from the walk: Wood piles, about 2 to 4 feet from the house.",
      "Photo from the walk: Wooden fences, within 3 feet of the house.",
    ]);
  });

  it("shows each item under Removed by the homeowner with its blurred still, and escapes its alt text", () => {
    const findings = [finding(1, { concept: '<b>"big"</b> & pile' as ResultFinding["concept"] }), finding(2), finding(3)];
    const page = reportHtml(input({ removed: new Set([id(1), id(3)]), stills: new Map([[id(1), STILL], [id(2), STILL], [id(3), "https://example.org/x.jpg"]]) }, { findings }));
    const start = page.indexOf('<section data-part="removed">');
    const removed = page.slice(start, page.indexOf("</section>", start));
    const said = "&lt;b&gt;&quot;big&quot;&lt;/b&gt; &amp; pile, about 6 to 9 feet from the house.";
    expect([...removed.matchAll(/<li data-finding="([^"]+)">(.*?)<\/li>/g)].map((m) => [m[1], m[2]])).toEqual([
      [id(1), `<div class="photo"><img src="${STILL}" alt="Photo from the walk: ${said}"></div><p>${said}</p>`],
      [id(3), "<p>Dry brush, about 6 to 9 feet from the house.</p>"],
    ]);
    expect(page).not.toContain("<b>");
  });

  it("lists no removed id that is not one of the walk's findings", () => {
    const page = reportHtml(input({ removed: new Set([id(7)]) }, { findings: [finding(1)] }));
    expect(page).not.toContain('data-part="removed"');
    expect(page).not.toContain(id(7));
  });

  it("keeps Still There and Unsure answers in the dated record, with the approval line on its day", () => {
    const rechecks = [
      { findingId: id(1), result: "still_there" as const, createdAt: "2026-11-02T10:00:00.000Z" },
      { findingId: id(1), result: "unsure" as const, createdAt: "2026-11-03T10:00:00.000Z" },
    ];
    expect(textIn(reportHtml(input({ rechecks, approvedAt: "2026-10-30T09:00:00.000Z" })), 'data-part="record"')).toEqual([
      "Walked Wednesday, October 28th, 2026.",
      "The homeowner checked the blurred photos and approved this record on Oct. 30th, 2026.",
      "Rechecked on Nov. 2nd, 2026, still shows in the new photo: Clear item 1.",
      "Rechecked on Nov. 3rd, 2026, the new photo could not show it clearly: Clear item 1.",
    ]);
  });

  it("escapes every word that came from the walk, so no markup or script reaches the page", () => {
    const page = reportHtml(input({}, { findings: [finding(1, { instruction: 'Move the <script>alert("x")</script> & pile.' })] }));
    expect(page).not.toContain("<script");
    expect(page).toContain("Move the &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; pile.");
  });

  it("allows no picture but an embedded JPEG still, and loads nothing from the network", () => {
    const page = reportHtml(input({ stills: new Map([[id(1), "https://example.org/still.jpg"]]) }));
    expect([...page.matchAll(/<img [^>]*\bsrc="([^"]*)"/g)].map((m) => m[1]!.slice(0, 22))).toEqual(["data:image/png;base64,"]);
    expect(page).not.toContain("still.jpg");
    expect(page).not.toMatch(/url\(["']?https?:/);
    expect(page).toContain(`content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"`);
  });

  it("embeds Atkinson Hyperlegible in 400 and 700 as data, and the lockup as one picture on the cover and in the running header", () => {
    const page = reportHtml(input());
    const faces = [...page.matchAll(/@font-face\{font-family:"Atkinson Hyperlegible";font-weight:(\d+);src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2"\)\}/g)];
    expect(faces.map((m) => m[1])).toEqual(["400", "700"]);
    for (const face of faces) expect(Buffer.from(face[2]!, "base64").subarray(0, 4).toString("latin1")).toBe("wOF2");
    const cover = /<img class="lockup" src="(data:image\/png;base64,[A-Za-z0-9+/=]+)" alt="EmberWalk, wildfire home check">/.exec(page);
    expect(cover).not.toBeNull();
    expect(page).toContain(`@top-center{content:image-set(url("${cover![1]}") 4x)`);
  });

  it("shows each finding as its photo, then its words, then the Zone, Rule and Status chips with their captions, then where the rule comes from", () => {
    const page = reportHtml(input({ stills: new Map([[id(1), STILL]]), statuses: new Map([[id(1), "fix_planned"]]) }));
    const row = rowOf(page, id(1));
    const at = [row.indexOf("<img"), row.indexOf('class="say"'), row.indexOf('data-part="distance"'), row.indexOf('class="cap">Zone'), row.indexOf('class="cap">Rule'), row.indexOf('class="cap">Status'), row.indexOf('data-part="sources"')];
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect([...row.matchAll(/<span class="cap">([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["Zone", "Rule", "Status"]);
  });

  it("numbers the photos under Fix These First from 1 and numbers no other photo", () => {
    const findings = [finding(1), finding(2, { distanceFeet: { low: 10, high: 12 } }), finding(3, { band: "zone_2", label: "recommended", distanceFeet: { low: 60, high: 70 } })];
    const page = reportHtml(input({ stills: new Map(findings.map((f) => [f.id, STILL])) }, { findings }));
    const numbers = (part: string) => [...page.slice(page.indexOf(part)).matchAll(/class="num">(\d+)</g)].map((m) => m[1]);
    expect([...page.matchAll(/class="num">(\d+)</g)].map((m) => m[1])).toEqual(["1", "2"]);
    expect(numbers('<section data-band="zone_2">')).toEqual([]);
  });

  it("shows the walk's day on the cover, and the approval's day only once the homeowner approved", () => {
    const open = reportHtml(input());
    expect(open).toContain('<p data-part="walked"><span class="k">Walked</span><strong>Wednesday, October 28th, 2026</strong></p>');
    expect(open).not.toContain('data-part="approved"');
    expect(reportHtml(input({ approvedAt: "2026-10-30T16:00:00.000Z" }))).toContain('<p data-part="approved"><span class="k">Approved by the homeowner</span><strong>Oct. 30th, 2026</strong></p>');
  });

  it("says what was checked: every side when coverage is checked, else each side gap and each thing not checked", () => {
    expect(reportHtml(input())).toContain(reportWords.allChecked);
    const gapped = reportHtml(input({}, { coverage: "not_checked", gaps: [{ side: "back", kind: "dark", hint: "more_light" }], notChecked: ["propane_tank"] }));
    expect(gapped).not.toContain(reportWords.allChecked);
    expect(gapped).toContain("The back side is too dark to check.");
    expect(gapped).toContain("Not checked on this walk: propane tanks.");
  });
});

describe("the report's fix first order", () => {
  const ids = (list: ResultFinding[]) => list.map((f) => f.id);

  it("lists nothing first while a side of the walk is missing, as the results screen does", () => {
    const order = reportOrder({ findings: [finding(1)], gaps: [{ side: "left", kind: "missing", hint: "walk_side" }] }, () => false);
    expect(order.first).toEqual([]);
    expect(order.bands.map((b) => ids(b.findings))).toEqual([[id(1)]]);
  });

  it("lists the blocking findings first, nearest first, when none is inside 30 feet", () => {
    const far = [finding(1, { band: "zone_2", distanceFeet: { low: 60, high: 70 } }), finding(2, { band: "zone_2", distanceFeet: { low: 40, high: 45 } })];
    expect(ids(reportOrder({ findings: far, gaps: [] }, () => false).first)).toEqual([id(2), id(1)]);
  });

  it("lists a Recommended item in the first 5 feet first, since Zone 0 blocks green whatever its label", () => {
    const zone0 = [finding(1, { label: "recommended", band: "zone_0", distanceFeet: { low: 0, high: 3 } })];
    expect(ids(reportOrder({ findings: zone0, gaps: [] }, () => false).first)).toEqual([id(1)]);
  });

  it("still lists first while only a corner has a gap, as the results screen does", () => {
    const order = reportOrder({ findings: [finding(1)], gaps: [{ side: "back_left", kind: "missing", hint: "pan_corner" }] }, () => false);
    expect(ids(order.first)).toEqual([id(1)]);
  });

  it("counts a finding at exactly 30 feet as outside the first list", () => {
    const edge = [finding(1, { band: "zone_2", distanceFeet: { low: 30, high: 32 } }), finding(2, { label: "recommended", band: "zone_2", distanceFeet: { low: 29.9, high: 31 } })];
    expect(ids(reportOrder({ findings: edge, gaps: [] }, () => false).first)).toEqual([id(2)]);
  });

  it("lists nothing first when nothing blocks, and every finding by band once", () => {
    const quiet = [finding(1, { label: "recommended", band: "zone_2", distanceFeet: { low: 40, high: 45 } }), finding(2, { label: "recommended", band: "zone_1", distanceFeet: { low: 10, high: 12 } })];
    const order = reportOrder({ findings: quiet, gaps: [] }, () => false);
    expect(order.first).toEqual([]);
    expect(order.bands.map((b) => [b.band, ids(b.findings)])).toEqual([
      ["zone_1", [id(2)]],
      ["zone_2", [id(1)]],
    ]);
  });
});

describe("a finding's status in the report", () => {
  const mark = { findingId: id(1), status: "done" as const, doneOn: "2026-11-01", markedAt: "2026-11-01T10:00:00.000Z" };

  it("is Rechecked only while the latest recheck answer is cleared and the item is Done", () => {
    const cleared = { findingId: id(1), result: "cleared" as const, createdAt: "2026-11-02T10:00:00.000Z" };
    const later = { findingId: id(1), result: "still_there" as const, createdAt: "2026-11-03T10:00:00.000Z" };
    expect(statusOf(id(1), "done", [mark], [cleared])).toEqual({ kind: "rechecked", on: "2026-11-02" });
    expect(statusOf(id(1), "done", [mark], [later, cleared])).toEqual({ kind: "done", doneOn: "2026-11-01" });
    expect(statusOf(id(1), "needs_fixing", [mark], [cleared])).toEqual({ kind: "needs_fixing" });
  });

  it("takes the day of the latest Done mark", () => {
    const again = { ...mark, doneOn: "2026-11-04", markedAt: "2026-11-04T10:00:00.000Z" };
    expect(statusOf(id(1), "done", [again, mark], [])).toEqual({ kind: "done", doneOn: "2026-11-04" });
    expect(statusOf(id(1), "done", [], [])).toEqual({ kind: "done", doneOn: null });
  });

  it("takes the day from a Done mark only, never from a later mark of another status", () => {
    const planned = { findingId: id(1), status: "fix_planned" as const, doneOn: "2026-11-09", markedAt: "2026-11-09T10:00:00.000Z" };
    const other = { ...mark, findingId: id(2), doneOn: "2026-11-08", markedAt: "2026-11-08T10:00:00.000Z" };
    expect(statusOf(id(1), "done", [mark, planned, other], [])).toEqual({ kind: "done", doneOn: "2026-11-01" });
  });
});

describe("a distance in the report", () => {
  it("rounds the near edge down and the far edge up, so 5.6 to 9.2 feet reads 5 to 10", () => {
    expect(reportWords.distance(5.6, 9.2)).toBe("About 5 to 10 feet from the house.");
    expect(reportWords.distance(0.4, 2.2)).toBe("Within 3 feet of the house.");
  });
});

describe("the words a finding prints", () => {
  const TEMPLATE = "Clear dry brush within 30 feet of the house.";

  const printed = (instruction: string, personal: string[] = []): string =>
    reportHtml(input({ templates: new Map([[id(1), TEMPLATE]]), personal }, { findings: [finding(1, { instruction })] }));

  it.each([
    "Clear the dry brush within 30 feet of the house at 418 Ember Hollow Lane.",
    "Mail the receipt to 1420 Oak Ridge Drive.",
    "Lleve la leña a 350 Calle del Sol.",
    "Haul it to 55 El Camino Real.",
    "Park at 1420 Highway 49.",
    "Mail it to 25 Del Monte Ave.",
    "Haul it to 100 Los Gatos Blvd.",
    "Haul it to 200 Las Palmas Dr.",
    "Haul it to 300 De Anza Blvd.",
    "Haul it to 12 Al Smith Dr.",
    "Haul it to 1420 O Street.",
    "MAIL THE RECEIPT TO 1420 OAK RIDGE DRIVE.",
    "Haul it to 1420 Martin Luther King Jr Blvd.",
    "Haul it to 2200 North Old Oak Ridge Rd.",
    "Haul it to 77 Sunset Loop.",
    "Haul it to 9 Quail Run.",
    "Haul it to 4100 Route 66.",
    "Lleve la leña a 12 Via del Mar.",
    "Lleve la leña a 120 Paseo de la Reforma.",
  ])("prints the rule's own words in place of a street address: %s", (instruction) => {
    const page = printed(instruction);
    expect(page).not.toContain(instruction);
    expect(page).toContain(TEMPLATE);
  });

  it.each([
    "Clear 2 shrubs along the drive.",
    "Mantenga 2 arbustos lejos del camino.",
    "Clear the dry brush within 30 feet of the drive.",
    "Move 3 bins along the road.",
    "Trim the tree 10 feet from the street side.",
  ])("prints an instruction that names no street word for word: %s", (instruction) => {
    const page = printed(instruction);
    expect(page).toContain(instruction);
    expect(page).not.toContain(TEMPLATE);
  });

  it("hides a stored name only where it stands as a whole word, in any letters", () => {
    expect(printed("Clear all the dry brush.", ["Al"])).toContain("Clear all the dry brush.");
    const named = printed("Ask AL to rake the gutters.", ["Al"]);
    expect(named).not.toContain("Ask AL to rake the gutters.");
    expect(named).toContain(TEMPLATE);
  });

  it.each([
    { name: "Ash", said: "Sweep up the ashes under the deck." },
    { name: "Ember", said: "Wet down the embers in the fire pit." },
    { name: "Pine", said: "Cut back the pines near the roof." },
    { name: "Oak", said: "Rake the leaves under the oaks." },
    { name: "Shrub", said: "Remove the shrubs against the wall." },
    { name: "Log", said: "Stack the logs away from the house." },
    { name: "Vent", said: "Cover the vents with fine mesh." },
    { name: "Fence", said: "Replace the wood fences touching the house." },
    { name: "Gutter", said: "Clear the gutters of dry needles." },
    { name: "Brush", said: "Cut back the brushes near the deck." },
  ])("keeps the finding's own wording when a crew is named $name and the sentence says the plural", ({ name, said }) => {
    const page = printed(said, [name]);
    expect(page).toContain(said);
    expect(page).not.toContain(TEMPLATE);
  });

  it("keeps the wording when the plural opens the sentence or is shouted", () => {
    expect(printed("Embers collect under the deck.", ["Ember"])).toContain("Embers collect under the deck.");
    expect(printed("REMOVE THE ASHES.", ["Ash"])).toContain("REMOVE THE ASHES.");
  });

  it.each([
    "Mail it to PO Box 12.",
    "Mail it to P.O. Box 12.",
    "Mail it to P O Box 4410.",
    "Mail it to po box 77.",
    "Haul it to 12 Rue de la Paix.",
    "Haul it to 40 Rue Cler.",
    "Haul it to 9 Mill Alley.",
    "Haul it to 9 Cedar Cove.",
    "Haul it to 9 Town Plaza.",
    "Haul it to 9 Union Square.",
    "Haul it to 9 Hill Row.",
    "Haul it to 9 Sunset Park.",
    "Haul it to 9 Donner Pass.",
    "Haul it to 9 Mill Aly.",
    "Haul it to 101 Del Mar.",
    "Haul it to 12 Las Palmas.",
    "Haul it to 5 Los Robles.",
    "Haul it to 8 El Dorado.",
  ])("prints the rule's own words in place of a further address: %s", (instruction) => {
    const page = printed(instruction);
    expect(page).not.toContain(instruction);
    expect(page).toContain(TEMPLATE);
  });

  it.each([
    "Space the 3 shrubs in a row.",
    "Clear 10 feet square around the vent.",
    "Park the trailer 30 feet from the house.",
    "Keep the 2 piles of logs apart.",
    "Move the box of ashes 5 feet away.",
    "Trim 4 branches at the pass of the fence.",
    "Clear 3 areas of the park side yard.",
    "Retire 2 los arbustos secos.",
    "Clear the area of the Las Vegas pile.",
  ])("prints a sentence with a number and a lookalike word as written: %s", (instruction) => {
    const page = printed(instruction);
    expect(page).toContain(instruction);
    expect(page).not.toContain(TEMPLATE);
  });

  it.each(["Fence", "Brush", "Ash", "Ember", "Pine", "Oak", "Shrub", "Log", "Vent", "Gutter", "Cedar", "Mulch"])(
    "swaps none of the real instructions from the live runs when a crew is named %s",
    (name) => {
      const swapped = liveInstructions.filter((instruction) => !printed(instruction, [name]).includes(instruction));
      expect(swapped).toEqual([]);
    },
  );

  it.each([
    { spoken: "Ask Fence to haul it.", stored: "Fence" },
    { spoken: "Ask the Brushes to haul it.", stored: "Brush" },
    { spoken: "Ask Ash to haul it.", stored: "Ash" },
    { spoken: "ask garcia to haul it.", stored: "Garcia" },
  ])("still hides a name spoken capitalized in the middle of a sentence: $spoken", ({ spoken, stored }) => {
    const page = printed(spoken, [stored]);
    expect(page).not.toContain(spoken);
    expect(page).toContain(TEMPLATE);
  });

  it.each([
    { spoken: "Ask the Garcias to rake.", stored: "GARCIA" },
    { spoken: "Ask the Garcias to rake.", stored: "garcia" },
    { spoken: "Ask Garcia Trees to rake.", stored: "GARCIA TREE" },
    { spoken: "Ask the O'neils to rake.", stored: "O'Neil" },
    { spoken: "Ask the O'Neils to rake.", stored: "O'Neil" },
    { spoken: 'Ask the "Garcias" to rake.', stored: "Garcia" },
    { spoken: "Ask (Garcias) to rake.", stored: "Garcia" },
    { spoken: "Ask the  Garcias to rake.", stored: "Garcia" },
    { spoken: "Ask the “Garcias” to rake.", stored: "Garcia" },
    { spoken: "Ask the ‘Garcias’ to rake.", stored: "Garcia" },
    { spoken: "Ask the Joneses to rake.", stored: "Jones" },
    { spoken: "Thanks, Garcias will rake.", stored: "Garcia" },
    { spoken: "Thanks; Garcias will rake.", stored: "Garcia" },
    { spoken: "Thanks: Garcias will rake.", stored: "Garcia" },
    { spoken: "Ask 2 Garcias to rake.", stored: "Garcia" },
  ])("hides the plural of a stored name in any spacing, quote or case: $spoken for $stored", ({ spoken, stored }) => {
    const page = printed(spoken, [stored]);
    expect(page).not.toContain(spoken);
    expect(page).toContain(TEMPLATE);
  });

  it.each([
    "Haul it to 12 DEL MAR.",
    "Haul it to 12 LAS PALMAS.",
    "Haul it to 5 LOS ROBLES.",
    "Haul it to 7 LA JOLLA.",
    "Haul it to 7 La Jolla.",
    "Haul it to 8 EL DORADO.",
    "Haul it to 12B Del Mar.",
    "Haul it to 12B Oak Lane.",
    "Haul it to 9 Cedar Cv.",
    "Haul it to 9 Town Plz.",
    "Haul it to 9 Union Sq.",
    "Haul it to 7 CR 12.",
    "Haul it to 7 SR 49.",
    "Haul it to 7 US 50.",
    "Haul it to 7 FM 1960.",
    "Haul it to 7 Interstate 80.",
    "Haul it to I-80.",
    "Haul it to 9 Pine Heights.",
    "Haul it to 9 Pine Hts.",
    "Haul it to 9 Owl Hollow.",
    "Haul it to 9 Fox Ridge.",
    "Haul it to 9 Fox Rdg.",
    "Haul it to 9 Eagle Canyon.",
    "Haul it to 9 Trout Creek.",
    "Haul it to 9 Lone Point.",
    "Haul it to 9 Lone Pt.",
    "Haul it to 9 Garden Walk.",
    "Haul it to 9 Bay Vista.",
    "Haul it to 9 Four Crossing.",
    "Haul it to 9 Four Xing.",
    "Haul it to 9 Oak Hill.",
    "Haul it to 9 River Bend.",
    "Haul it to 9 Elm Grove.",
    "Haul it to 9 Ohio Turnpike.",
    "Haul it to 9 Gulf Expressway.",
    "Haul it to 9 Gulf Freeway.",
    "Mail it to Post Office Box 12.",
    "Mail it to POB 12.",
    "Mail it to PO Drawer 12.",
    "Mail it to RR 2 Box 15.",
    "Mail it to HC 62 Box 15.",
    "Mail it to PO box #12.",
    "Mail it to PO Box A.",
    "Haul it to 100 Avenue C.",
    "Haul it to 12 Avenue of the Americas.",
    "Haul it to 12 Vista del Mar.",
    "Haul it to 1420 Broadway.",
    "Email me at a at c dot co.",
  ])("also prints the rule's own words in place of: %s", (instruction) => {
    const page = printed(instruction);
    expect(page).not.toContain(instruction);
    expect(page).toContain(TEMPLATE);
  });

  it.each([
    "Cubra 3 La leña seca.",
    "Plant 3 Pines along the fence.",
    "Trim 3 Pines near the creek.",
    "Remove 2 dead Oaks.",
    "Cover the 12 vents on the walk.",
    "Stack the logs at the gate and put the rest on the porch.",
    "Meet the crew at the gate on Broadway Street side.",
    "Keep 3 piles 30 feet apart.",
  ])("leaves a plain sentence as written: %s", (instruction) => {
    const page = printed(instruction);
    expect(page).toContain(instruction);
    expect(page).not.toContain(TEMPLATE);
  });

  it.each([
    { kind: "a curly apostrophe for a straight one", spoken: "Ask O’Neil to haul the brush.", stored: "O'Neil" },
    { kind: "the name without its accent", spoken: "Ask Jose to haul the brush.", stored: "José" },
    { kind: "the name with its accent", spoken: "Ask José to haul the brush.", stored: "Jose" },
    { kind: "the accent written as a separate mark", spoken: "Ask José to haul the brush.", stored: "José" },
    { kind: "the name made plural", spoken: "The Garcias rake the brush.", stored: "Garcia" },
  ])("hides a stored name spoken with $kind", ({ spoken, stored }) => {
    const page = printed(spoken, [stored]);
    expect(page).not.toContain(spoken);
    expect(page).toContain(TEMPLATE);
  });
});
