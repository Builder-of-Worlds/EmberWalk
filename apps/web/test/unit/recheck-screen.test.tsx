import { DEFAULT_LIMITS, RECHECK_ROUTE_CODES } from "@emberwalk/shared";
import type { Recheck } from "@emberwalk/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { copy } from "../../src/copy.ts";
import { recheckWords } from "../../src/draft-words.ts";
import { isRechecked } from "../../src/finding-marks.ts";
import type { RecheckApi, RecheckCode } from "../../src/recheck-api.ts";
import type { WalkResults } from "../../src/results.ts";
import { recheckFor, resultsFor } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { deniedError, fakeStream, grantedMedia, memoryMarks, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { finding, walk } from "./result-fakes.ts";

const ON = { ...DEFAULT_LIMITS, recheckOn: true };
const ITEM = "item-1";
const SHOT = new Blob(["jpeg"], { type: "image/jpeg" });

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const answer = (result: Recheck["result"]): Recheck => ({
  id: "recheck-1",
  findingId: ITEM,
  photo: "rechecks/walk-1/item-1/recheck-1.jpg",
  result,
  createdAt: "2026-10-30T15:00:00.000Z",
});

const sentBy = (reply: Awaited<ReturnType<RecheckApi["send"]>>) => {
  const sent: { findingId: string; photo: Blob }[] = [];
  const rechecks: RecheckApi = {
    send: async (findingId, photo) => {
      sent.push({ findingId, photo });
      return reply;
    },
  };
  return { sent, rechecks };
};

const mounted: (() => Promise<void>)[] = [];

const shown = async (deps: ReturnType<typeof testDeps>) => {
  const view = await render(<App deps={deps} />);
  mounted.push(view.unmount);
  return view;
};

const open = async (results: WalkResults, over: Parameters<typeof testDeps>[0] = {}, done = true) => {
  const marks = memoryMarks();
  if (done) marks.setStatus(results.id, ITEM, "done");
  const media = grantedMedia();
  window.location.hash = recheckFor(results.id, ITEM);
  const deps = testDeps({ limits: ON, marks, media, results: async (id) => (id === results.id ? results : null), ...over });
  const view = await shown(deps);
  await settle(() => new Promise((r) => setTimeout(r, 20)));
  return { ...view, deps, marks, media };
};

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label);

const takePhoto = async (host: HTMLElement) => {
  await until(() => button(host, recheckWords.take) !== undefined);
  await settle(() => button(host, recheckWords.take)!.click());
  await settle(() => new Promise((r) => setTimeout(r, 20)));
};

const LIVE = walk([finding(ITEM)]);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (done: BlobCallback, type?: string) {
    done(type === "image/jpeg" ? SHOT : null);
  });
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("the recheck screen", () => {
  it("shows nothing and opens no camera while the recheck flag is off", async () => {
    const view = await open(LIVE, { limits: { ...DEFAULT_LIMITS, recheckOn: false } });
    expect(view.host.querySelector("main")).toBeNull();
    expect(view.media.getUserMedia).not.toHaveBeenCalled();
  });

  it("opens the back camera with the old photo faint over it", async () => {
    const view = await open(LIVE);
    await until(() => view.host.querySelector("video") !== null);
    expect(view.host.querySelector("h1")?.textContent).toBe(recheckWords.title);
    expect(view.media.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" } });
    const old = view.host.querySelector<HTMLImageElement>("[data-part=old-photo]");
    expect(old?.getAttribute("src")).toBe(`${ITEM}.jpg`);
    expect(Number(old?.style.opacity)).toBeGreaterThan(0.2);
    expect(Number(old?.style.opacity)).toBeLessThan(0.5);
    expect(view.host.querySelector("a[data-part=back]")?.getAttribute("href")).toBe(resultsFor(LIVE.id));
  });

  it("shows a recorded sample recheck: the after photo over the old one, no camera, no server, and the answer the real check gave", async () => {
    const sample = walk([finding(ITEM)], [], { id: SAMPLES[0]!.id });
    const { sent, rechecks } = sentBy({ code: "offline" });
    const sampleRechecks = { [sample.id]: { [ITEM]: { photo: "after.jpg", result: "cleared" as const, checkedOn: "2026-11-01" } } };
    const view = await open(sample, { rechecks, sampleRechecks });
    await until(() => view.host.querySelector("[data-part=sample-after]") !== null);
    expect(view.host.querySelector("[data-part=sample-after]")?.getAttribute("src")).toBe("after.jpg");
    expect(view.media.getUserMedia).not.toHaveBeenCalled();
    await settle(() => button(view.host, recheckWords.useSample)!.click());
    expect(view.text()).toContain(recheckWords.answer.cleared);
    expect(view.text()).toContain(recheckWords.sampleNote);
    expect(view.marks.statusOf(sample.id, ITEM).recheck?.result).toBe("cleared");
    expect(sent).toEqual([]);
  });

  it("still asks for Done first on a recorded sample", async () => {
    const sample = walk([finding(ITEM)], [], { id: SAMPLES[0]!.id });
    const sampleRechecks = { [sample.id]: { [ITEM]: { photo: "after.jpg", result: "cleared" as const, checkedOn: "2026-11-01" } } };
    const view = await open(sample, { sampleRechecks }, false);
    await until(() => view.text().includes(recheckWords.notDone));
    expect(view.host.querySelector("[data-part=sample-after]")).toBeNull();
  });

  it("refuses a sample walk and opens no camera", async () => {
    const sample = walk([finding(ITEM)], [], { id: SAMPLES[0]!.id });
    const view = await open(sample);
    await until(() => view.text().includes(recheckWords.sample));
    expect(view.host.querySelector("video")).toBeNull();
    expect(button(view.host, recheckWords.take)).toBeUndefined();
    expect(view.media.getUserMedia).not.toHaveBeenCalled();
  });

  it("refuses an item not marked Done and opens no camera", async () => {
    const view = await open(LIVE, {}, false);
    await until(() => view.text().includes(recheckWords.notDone));
    expect(view.host.querySelector("video")).toBeNull();
    expect(view.media.getUserMedia).not.toHaveBeenCalled();
  });

  it("goes back to the results for a finding the walk does not hold", async () => {
    window.location.hash = recheckFor(LIVE.id, "gone");
    const deps = testDeps({ limits: ON, results: async () => LIVE });
    await shown(deps);
    await until(() => window.location.hash === resultsFor(LIVE.id));
  });

  it("says plainly when the camera cannot open", async () => {
    const media = grantedMedia();
    media.getUserMedia.mockRejectedValue(deniedError());
    const view = await open(LIVE, { media });
    await until(() => view.text().includes(recheckWords.noCamera));
    expect(button(view.host, recheckWords.take)).toBeUndefined();
    expect(view.host.querySelector("a[data-part=back]")).not.toBeNull();
  });

  it("sends a JPEG of the camera and marks the item Rechecked on a cleared answer", async () => {
    const { sent, rechecks } = sentBy({ recheck: answer("cleared") });
    const view = await open(LIVE, { rechecks });
    await takePhoto(view.host);
    expect(sent).toEqual([{ findingId: ITEM, photo: SHOT }]);
    const status = view.marks.statusOf(LIVE.id, ITEM);
    expect(isRechecked(status)).toBe(true);
    expect(status.recheck).toEqual({ photo: answer("cleared").photo, atMs: Date.parse("2026-10-30T15:00:00.000Z"), result: "cleared" });
    expect(view.text()).toContain(recheckWords.answer.cleared);
    expect(view.host.querySelector("[data-status=rechecked]")?.textContent).toContain(copy.status.rechecked);
  });

  it.each(["still_there", "unsure"] as const)("keeps a %s answer without marking the item Rechecked", async (result) => {
    const { rechecks } = sentBy({ recheck: answer(result) });
    const view = await open(LIVE, { rechecks });
    await takePhoto(view.host);
    expect(view.text()).toContain(recheckWords.answer[result]);
    const status = view.marks.statusOf(LIVE.id, ITEM);
    expect(status.recheck?.result).toBe(result);
    expect(isRechecked(status)).toBe(false);
    expect(view.host.querySelector("[data-status=rechecked]")).toBeNull();
    expect(button(view.host, recheckWords.take)).toBeDefined();
  });

  it.each([...RECHECK_ROUTE_CODES, "offline"] as RecheckCode[])("says what happened on a %s refusal and keeps the item as it was", async (code) => {
    const { rechecks } = sentBy({ code });
    const view = await open(LIVE, { rechecks });
    await takePhoto(view.host);
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(recheckWords.failed[code]);
    expect(view.marks.statusOf(LIVE.id, ITEM).recheck).toBeNull();
    expect(button(view.host, recheckWords.take)).toBeDefined();
  });

  it("turns the camera off when the visitor leaves the screen", async () => {
    const { stream, track } = fakeStream(false);
    const media = grantedMedia();
    media.getUserMedia.mockResolvedValue(stream);
    const view = await open(LIVE, { media });
    await until(() => button(view.host, recheckWords.take) !== undefined);
    expect(track.stop).not.toHaveBeenCalled();
    await settle(() => {
      window.location.hash = resultsFor(LIVE.id);
    });
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(track.stop).toHaveBeenCalled();
  });

  it("turns off a camera that opens after the visitor has left", async () => {
    const { stream, track } = fakeStream(false);
    const media = grantedMedia();
    let opens: (opened: MediaStream) => void = () => undefined;
    media.getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => (opens = resolve)));
    await open(LIVE, { media });
    await settle(() => {
      window.location.hash = resultsFor(LIVE.id);
    });
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(track.stop).not.toHaveBeenCalled();
    await settle(() => opens(stream));
    expect(track.stop).toHaveBeenCalled();
  });

  it("sends nothing when no photo could be taken", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((done: BlobCallback) => done(null));
    const { sent, rechecks } = sentBy({ recheck: answer("cleared") });
    const view = await open(LIVE, { rechecks });
    await takePhoto(view.host);
    expect(sent).toEqual([]);
    expect(view.text()).toContain(recheckWords.noPhoto);
  });
});
