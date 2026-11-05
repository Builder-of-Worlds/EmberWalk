import { afterEach, describe, expect, it } from "vitest";
import { demoFixed, DEMO_ADDRESS, withDemo } from "../../src/demo-fixed.ts";
import { demoWords } from "../../src/draft-words.ts";
import { copy, draft } from "../../src/copy.ts";
import { fixedApi } from "../../src/fixed-api.ts";
import { fixFor, inspectionFor, resultsFor } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { memoryMarks, memoryStorage } from "./fakes.ts";
import { standIn, standInFetch } from "./fixed-fakes.ts";
import { find, has, mount, tap, typeInto, until } from "./fixed-screen.tsx";

const SAMPLE = SAMPLES[0]!;
const ITEM = SAMPLE.findings[0]!;

const opened = async (hash: string, marks = memoryMarks()) => {
  const state = standIn();
  const results = async (id: string) => (id === SAMPLE.id ? SAMPLE : null);
  const real = fixedApi(window.location.origin, standInFetch(state), () => "a".repeat(64));
  const fixed = withDemo(real, demoFixed({ results, samples: [SAMPLE], marks, now: () => new Date("2026-11-01T10:00:00.000Z"), storage: memoryStorage() }), results);
  const view = await mount(hash, state, { results, fixed, marks });
  return { state, view, marks };
};

const planned = async (hash = fixFor(SAMPLE.id)) => {
  const open = await opened(hash);
  await until(() => open.view.host.querySelector("#zip") !== null);
  await typeInto(find<HTMLInputElement>(open.view.host, "#zip"), "95370");
  await tap(open.view.host, draft.fixed.zipButton);
  await until(() => open.view.host.querySelector("[data-job]") !== null);
  return open;
};

afterEach(() => {
  window.location.hash = "";
});

describe("Get It Fixed on a sample house", () => {
  it("is offered on the sample's results", async () => {
    const { view } = await opened(resultsFor(SAMPLE.id));
    await until(() => view.host.querySelector("li.finding") !== null);
    expect(view.host.querySelector("[data-part=get-it-fixed]")?.getAttribute("href")).toBe(fixFor(SAMPLE.id));
    await view.unmount();
  });

  it("lists only labelled sample crews, whose address is the demo inbox", async () => {
    const { view } = await planned();
    const crews = [...view.host.querySelectorAll("li.crew")];
    expect(crews).toHaveLength(3);
    for (const crew of crews) {
      expect(crew.querySelector("[data-part=sample]")?.textContent).toBe(draft.fixed.sample);
      expect(crew.querySelector("[data-part=email]")?.textContent).toContain(DEMO_ADDRESS);
    }
    await view.unmount();
  });

  it("takes a request to the demo inbox only on the homeowner's tap, and asks the server nothing", async () => {
    const { view, state } = await planned();
    await tap(view.host, draft.fixed.writeRequests);
    await until(() => view.host.querySelector("li.message") !== null);
    const body = view.host.querySelector("[data-part=demo-inbox]");
    expect(body?.querySelectorAll("[data-part=inbox-message]").length ?? 0).toBe(0);
    await tap(view.host, draft.fixed.review);
    await until(() => view.host.querySelector("main.approve") !== null);
    expect(find(view.host, "[data-part=body]").textContent).toContain("Sample");
    expect(find(view.host, "[data-part=body]").textContent).toContain(ITEM.instruction);
    await tap(view.host, draft.approve.email);
    await until(() => view.text().includes(draft.approve.sentEmail));
    await tap(view.host, draft.fixed.backToFix);
    await until(() => view.host.querySelector("[data-part=demo-inbox]") !== null);
    expect(view.host.querySelectorAll("[data-part=inbox-message]")).toHaveLength(1);
    expect(find(view.host, "[data-part=demo-inbox]").textContent).toContain(demoWords.inboxLead);
    expect(find(view.host, "[data-part=inbox-message]").textContent).toContain(ITEM.instruction);
    expect(state.calls).toEqual([]);
    await view.unmount();
  });

  it("lets the homeowner log what a sample crew said, and reads nothing with a model", async () => {
    const { view, state } = await planned();
    await tap(view.host, draft.fixed.writeRequests);
    await until(() => view.host.querySelector("li.message") !== null);
    await tap(view.host, draft.fixed.review);
    await until(() => view.host.querySelector("main.approve") !== null);
    await tap(view.host, draft.approve.email);
    await until(() => view.text().includes(draft.approve.sentEmail));
    await tap(view.host, draft.fixed.backToFix);
    await until(() => view.host.querySelector("textarea") !== null);
    await typeInto(find<HTMLTextAreaElement>(view.host, "textarea"), "We can come Tuesday.");
    await tap(view.host, draft.fixed.logReply);
    await until(() => view.text().includes("We can come Tuesday."));
    expect(view.host.querySelector("[data-part=reading]")).toBeNull();
    expect(state.calls).toEqual([]);
    await view.unmount();
  });

  it("waits for every Required Now item before the inspection draft, then labels it a sample with no department", async () => {
    const { view } = await opened(inspectionFor(SAMPLE.id));
    await until(() => view.host.querySelector("main.inspection[data-ready=false] .problem") !== null);
    await view.unmount();
    const marks = memoryMarks();
    marks.setStatus(SAMPLE.id, ITEM.id, "done");
    const done = await opened(inspectionFor(SAMPLE.id), marks);
    await until(() => done.view.host.querySelector("main.inspection[data-ready=true]") !== null);
    expect(find(done.view.host, "[data-part=subject]").textContent).toContain("Synthetic sample house");
    expect(find(done.view.host, "[data-part=body]").textContent).toContain(ITEM.instruction);
    expect(done.view.host.querySelector("[data-part=department]")).toBeNull();
    expect(has(done.view.host, draft.inspection.copy)).toBe(true);
    await done.view.unmount();
  });

  it("keeps its work when the page comes back", async () => {
    const storage = memoryStorage();
    const results = async (id: string) => (id === SAMPLE.id ? SAMPLE : null);
    const made = () => demoFixed({ results, samples: [SAMPLE], marks: memoryMarks(), now: () => new Date("2026-11-01T10:00:00.000Z"), storage });
    const first = await made().plan(SAMPLE.id, "95370");
    expect(first.value?.jobs).toHaveLength(1);
    expect((await made().jobs(SAMPLE.id)).value?.jobs).toHaveLength(1);
    expect(copy.results).toBeDefined();
  });
});

describe("a real walk beside the demo", () => {
  it("still goes to the server", async () => {
    const state = standIn();
    const results = async () => ({ ...SAMPLE, id: "live", synthetic: false });
    const real = fixedApi(window.location.origin, standInFetch(state), () => "a".repeat(64));
    const fixed = withDemo(real, demoFixed({ results, samples: [], marks: memoryMarks(), now: () => new Date(),storage: memoryStorage() }), results);
    await fixed.jobs("live");
    expect(state.calls.map((c) => c.method)).toEqual(["GET"]);
  });
});
