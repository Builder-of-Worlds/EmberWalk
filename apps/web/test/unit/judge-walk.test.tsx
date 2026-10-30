import { afterEach, describe, expect, it } from "vitest";
import { copy } from "../../src/copy.ts";
import { JUDGE_WALK_FILE } from "../../src/judge.ts";
import { resultsFor } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { JudgeWalk } from "../../src/screens/JudgeWalk.tsx";
import { render, settle } from "./render.ts";

const SAMPLE_RESULTS = resultsFor(SAMPLES[0]!.id);

afterEach(() => {
  window.location.hash = "";
});

describe("the judge copy's walk", () => {
  it("plays the walk video without asking for a camera, and offers a way past it", async () => {
    let asked = 0;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => void (asked += 1) } });
    const view = await render(<JudgeWalk />);
    const video = view.host.querySelector("video");
    expect(video?.getAttribute("src")).toMatch(new RegExp(`${JUDGE_WALK_FILE}$`));
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(asked).toBe(0);
    const skip = [...view.host.querySelectorAll("a")].find((a) => a.textContent === copy.home.sample);
    expect(skip?.getAttribute("href")).toBe(SAMPLE_RESULTS);
    await view.unmount();
  });

  it.each(["ended", "error"])("goes to the results when the video fires %s", async (name) => {
    const view = await render(<JudgeWalk />);
    expect(window.location.hash).not.toBe(SAMPLE_RESULTS);
    await settle(() => view.host.querySelector("video")?.dispatchEvent(new Event(name)));
    expect(window.location.hash).toBe(SAMPLE_RESULTS);
    await view.unmount();
  });
});
