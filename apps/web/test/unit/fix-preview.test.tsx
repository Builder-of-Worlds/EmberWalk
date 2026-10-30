import { previewPath, stillPath } from "@emberwalk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { copy } from "../../src/copy.ts";
import { isLiveStill, toWalkResults } from "../../src/live-api.ts";
import type { ResultFinding, WalkResults } from "../../src/results.ts";
import { findingFor } from "../../src/router.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { feet, finding, LIVE_WALK, liveBody, liveFindingId, walk } from "./result-fakes.ts";

const BASE = "https://ember.test";
const PREVIEW = `${BASE}${previewPath(LIVE_WALK, liveFindingId(1))}`;
const FLAG = { verdict: "flags" as const, reason: "The rule asks for 30 feet, not 5." };

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const open = async (f: ResultFinding, stills: (url: string) => Promise<Blob | null> = async () => null) => {
  const results: WalkResults = walk([f]);
  window.location.hash = findingFor(results.id, f.id);
  const view = await render(<App deps={testDeps({ results: async (id) => (id === results.id ? results : null), stills })} />);
  await until(() => view.host.querySelector("main.one-finding") !== null);
  return view;
};

const buttons = (host: HTMLElement) => [...host.querySelectorAll("button")].map((b) => b.textContent);

const press = async (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no button "${label}"`);
  await settle(() => button.click());
};

afterEach(() => {
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("See It Fixed", () => {
  it("sits under More after Where This Comes From and before What You Said, and opens the preview with its label on the image", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const stills = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
    const view = await open(finding("a", { preview: PREVIEW, voiceNote: "The brush is dry." }), stills);
    expect(buttons(view.host)).not.toContain(copy.finding.seeFixed);

    await press(view.host, copy.finding.more);
    expect(buttons(view.host)).toContain("See It Fixed");
    const more = view.host.querySelector("#more")!;
    const order = [...more.querySelectorAll("h2, button")].map((e) => e.textContent);
    expect(order.indexOf(copy.finding.seeFixed)).toBeGreaterThan(order.indexOf(copy.finding.source));
    expect(order.indexOf(copy.finding.seeFixed)).toBeLessThan(order.indexOf(copy.finding.said));
    expect(view.host.querySelector(".fix-preview")).toBeNull();

    await press(view.host, copy.finding.seeFixed);
    await settle();
    const figure = view.host.querySelector("figure.fix-preview")!;
    expect(stills).toHaveBeenCalledWith(PREVIEW);
    expect(figure.querySelector("img")?.getAttribute("src")).toBe("blob:preview-1");
    expect(figure.querySelector("figcaption")?.textContent).toBe("AI preview, not a photo");
    expect(view.host.querySelector("main .proof img")?.getAttribute("src")).not.toBe("blob:preview-1");

    await press(view.host, copy.finding.seeFixed);
    expect(view.host.querySelector(".fix-preview")).toBeNull();
    await view.unmount();
  });

  it("takes the button and the figure away when the preview cannot be fetched", async () => {
    const stills = vi.fn(async () => null);
    const view = await open(finding("e", { preview: PREVIEW }), stills);
    await press(view.host, copy.finding.more);
    await press(view.host, copy.finding.seeFixed);
    await until(() => !buttons(view.host).includes(copy.finding.seeFixed));
    expect(stills).toHaveBeenCalledWith(PREVIEW);
    expect(view.host.querySelector(".fix-preview")).toBeNull();
    expect(buttons(view.host)).toContain(copy.finding.more);
    await view.unmount();
  });

  it("shows a preview that needs no fetch, and keeps its button", async () => {
    const stills = vi.fn(async () => null);
    const view = await open(finding("f", { preview: "/sample/after-front.jpg" }), stills);
    await press(view.host, copy.finding.more);
    await press(view.host, copy.finding.seeFixed);
    await settle();
    expect(view.host.querySelector("figure.fix-preview img")?.getAttribute("src")).toBe("/sample/after-front.jpg");
    expect(buttons(view.host)).toContain(copy.finding.seeFixed);
    expect(stills).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("stays hidden when no preview was made", async () => {
    for (const preview of [undefined, null]) {
      const view = await open(finding("b", preview === undefined ? {} : { preview }));
      await press(view.host, copy.finding.more);
      expect(buttons(view.host)).not.toContain(copy.finding.seeFixed);
      await view.unmount();
    }
  });
});

describe("the second check note", () => {
  it("shows a flag's reason under the sentence and changes nothing else", async () => {
    const f = finding("c", { ...feet(2), band: "zone_0", secondCheck: FLAG });
    const view = await open(f);
    const note = view.host.querySelector(".second-check");
    expect(note?.textContent).toBe("Second check disagrees: The rule asks for 30 feet, not 5.");
    expect(note?.textContent).toBe(copy.finding.secondCheck(FLAG.reason));
    expect(view.host.querySelector(".sentence")?.textContent).toBe(f.instruction);
    expect(view.host.querySelector(".label")?.textContent).toBe(copy.results.label.required_now);
    await view.unmount();
  });

  it("shows nothing when the second check agrees or did not run", async () => {
    for (const secondCheck of [{ verdict: "agrees" as const, reason: "Fits the rule." }, null, undefined]) {
      const view = await open(finding("d", secondCheck === undefined ? {} : { secondCheck }));
      expect(view.host.querySelector(".second-check")).toBeNull();
      expect(view.text()).not.toContain("Fits the rule.");
      await view.unmount();
    }
  });
});

describe("live previews", () => {
  it("turns a preview path into an absolute link the phone fetches like a still", () => {
    const body = liveBody();
    const id = liveFindingId(1);
    const results = toWalkResults({ ...body, findings: body.findings.map((f, i) => (i === 0 ? { ...f, preview: previewPath(LIVE_WALK, id), secondCheck: FLAG } : f)) }, BASE);
    expect(results.findings[0]).toMatchObject({ preview: PREVIEW, secondCheck: FLAG });
    expect(results.findings[1]).not.toHaveProperty("preview");
    expect(isLiveStill(PREVIEW)).toBe(true);
    expect(isLiveStill(`${BASE}${stillPath(LIVE_WALK, id)}`)).toBe(true);
    expect(isLiveStill(`${BASE}/api/walks/${LIVE_WALK}/fixes/${id}`)).toBe(false);
  });
});
