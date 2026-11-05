import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JUDGE_MEDIA, judgeWords } from "../../src/judge.ts";
import { checkingFor, resultsFor } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { JudgeWalk, walkLine } from "../../src/screens/JudgeWalk.tsx";
import { render, settle } from "./render.ts";

const ID = SAMPLES[0]!.id;

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = () => "maybe";
  HTMLMediaElement.prototype.play = async () => undefined;
});

afterEach(() => {
  window.location.hash = "";
});

describe("the judges' sample walk", () => {
  it("plays the walk file without asking for a camera, labelled, and offers a way past it", async () => {
    let asked = 0;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => void (asked += 1) } });
    const view = await render(<JudgeWalk />);
    const video = view.host.querySelector("video");
    await settle(() => undefined);
    expect(video?.getAttribute("src")).toMatch(new RegExp(`${JUDGE_MEDIA.walk}$`));
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(asked).toBe(0);
    expect(view.host.textContent).toContain(judgeWords.label);
    expect([...view.host.querySelectorAll("a")].find((a) => a.textContent === judgeWords.resultsButton)?.getAttribute("href")).toBe(resultsFor(ID));
    await view.unmount();
  });

  it("goes on to the checking steps when the walk ends", async () => {
    const view = await render(<JudgeWalk />);
    await settle(() => view.host.querySelector("video")?.dispatchEvent(new Event("ended")));
    expect(window.location.hash).toBe(checkingFor(ID));
    await view.unmount();
  });

  it("says so when the file fails, and stays on the screen instead of jumping away", async () => {
    const view = await render(<JudgeWalk />);
    await settle(() => undefined);
    await settle(() => view.host.querySelector("video")?.dispatchEvent(new Event("error")));
    expect(view.host.textContent).toContain(judgeWords.walkFailed);
    expect(window.location.hash).toBe("");
    await view.unmount();
  });

  it("names the walk and each corner stop by the time in the file", () => {
    expect(walkLine(25.7, true)).toBe(judgeWords.walking("back"));
    expect(walkLine(39.7, true)).toBe(judgeWords.panning("back"));
    expect(walkLine(59.5, true)).toBe(judgeWords.panning("right"));
    expect(walkLine(60.5, true)).toBe(judgeWords.walking("front"));
    expect(walkLine(0)).toBe(judgeWords.walking("left"));
    expect(walkLine(12)).toBe(judgeWords.panning("left"));
    expect(walkLine(22)).toBe(judgeWords.walking("back"));
    expect(walkLine(30)).toBe(judgeWords.panning("back"));
    expect(walkLine(50)).toBe(judgeWords.panning("right"));
    expect(walkLine(70)).toBe(judgeWords.panning("front"));
    expect(walkLine(19)).toBe(judgeWords.panning("left"));
    expect(walkLine(78)).toBe(judgeWords.panning("front"));
    expect(walkLine(78.6)).toBe(judgeWords.arriving);
  });
});
