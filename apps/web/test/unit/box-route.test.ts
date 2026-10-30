import { describe, expect, it } from "vitest";
import answers from "../../../../fixtures/meta/box-probe-test-yard-2-answers.json";
import rows from "../../../../fixtures/meta/box-probe-test-yard-2-rows.json";
import { type Box, boxAt, damp, dampBox, frameAt, phaseAt, pixelBox, samBoxes, secondsAt, trackRate } from "../../src/beat/box-route.ts";

type Answer = { output: { type: string; content?: { text?: string }[] }[] };

const row = rows[0]!.find((r) => r.hazard === "dry-brush-1")!;
const samText = (answers as unknown as Record<string, Answer>)[`pass1-${row.samFingerprint}`]!.output
  .flatMap((o) => o.content ?? [])
  .map((c) => c.text ?? "")
  .join("");

const close = (a: Box, b: Box) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe("the box route beat", () => {
  it("reads every tracked frame of the recorded SAM 3.1 answer, normalised to the frame", () => {
    const boxes = samBoxes(samText);
    expect([...boxes.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, i) => 15 + i));
    close(boxes.get(20)!, [274 / 1920, 451 / 1080, 876 / 1920, 723 / 1080]);
  });

  it("skips lines with no frame, no box or an empty box", () => {
    const boxes = samBoxes(
      [
        "<3f>1<|box;x1=10;y1=10;x2=20;y2=20;w=100;h=100;c=0.9|>",
        "<4f>1<|box;x1=20;y1=10;x2=10;y2=20;w=100;h=100;c=0.9|>",
        "<5f>1<|box;x1=10;y1=10;x2=20;y2=20;w=0;h=100;c=0.9|>",
        "<|box;x1=10;y1=10;x2=20;y2=20;w=100;h=100;c=0.9|>",
        "<6f>0",
        "<7f>1<|box;x1=10;y1=10;x2=20;y2=20;w=100;h=0;c=0.9|>",
        "<8f>1<|box;x1=10;y1=10;x2=10;y2=20;w=100;h=100;c=0.9|>",
        "<9f>1<|box;x1=10;y1=20;x2=20;y2=20;w=100;h=100;c=0.9|>",
        "<10f>1<|box;x1=10;y1=20;x2=20;y2=10;w=100;h=100;c=0.9|>",
        "<11f>1<|box;x1=0;y1=0;x2=1;y2=1;w=1;h=1;c=0.9|>",
      ].join("\n"),
    );
    expect([...boxes.keys()]).toEqual([3, 11]);
    close(boxes.get(3)!, [0.1, 0.1, 0.2, 0.2]);
    close(boxes.get(11)!, [0, 0, 1, 1]);
  });

  it("places Muse Spark's pointed box as a share of the frame", () => {
    close(pixelBox(row.pixels, 1920, 1080), [264 / 1920, 444 / 1080, 884 / 1920, 719 / 1080]);
  });

  it("blends between the nearest tracked frames and shows nothing outside them", () => {
    const boxes = new Map<number, Box>([
      [2, [0, 0, 0.2, 0.2]],
      [4, [0.2, 0.2, 0.6, 0.6]],
    ]);
    close(boxAt(boxes, 3)!, [0.1, 0.1, 0.4, 0.4]);
    close(boxAt(boxes, 2.5)!, [0.05, 0.05, 0.3, 0.3]);
    close(boxAt(boxes, 4)!, [0.2, 0.2, 0.6, 0.6]);
    close(boxAt(boxes, 2)!, [0, 0, 0.2, 0.2]);
    const unsorted = new Map<number, Box>([
      [6, [0.4, 0.4, 0.8, 0.8]],
      [2, [0, 0, 0.2, 0.2]],
      [4, [0.2, 0.2, 0.6, 0.6]],
    ]);
    close(boxAt(unsorted, 5)!, [0.3, 0.3, 0.7, 0.7]);
    close(boxAt(unsorted, 3)!, [0.1, 0.1, 0.4, 0.4]);
    expect(boxAt(boxes, 1.99)).toBeNull();
    expect(boxAt(boxes, 4.01)).toBeNull();
    expect(boxAt(new Map(), 0)).toBeNull();
  });

  it("runs the phrase, then the point, then the track over eight seconds", () => {
    expect(phaseAt(-1)).toEqual({ name: "phrase", progress: 0 });
    expect(phaseAt(1.25)).toEqual({ name: "phrase", progress: 0.5 });
    expect(phaseAt(2.5)).toEqual({ name: "point", progress: 0 });
    expect(phaseAt(3.5)).toEqual({ name: "point", progress: 0.5 });
    expect(phaseAt(4.5)).toEqual({ name: "track", progress: 0 });
    expect(phaseAt(6.25)).toEqual({ name: "track", progress: 0.5 });
    expect(phaseAt(8)).toEqual({ name: "track", progress: 1 });
    expect(phaseAt(30)).toEqual({ name: "track", progress: 1 });
  });

  it("maps probe frames taken at 2 a second to video time and back", () => {
    expect(secondsAt(20)).toBe(10.25);
    expect(frameAt(10.25)).toBe(20);
    expect(frameAt(secondsAt(31))).toBe(31);
  });

  it("plays the tracked stretch of the walk inside the track phase", () => {
    const rate = trackRate(row.frame, 31);
    expect(rate).toBeCloseTo(5.5 / 3.5, 9);
    expect(secondsAt(row.frame) + rate * 3.5).toBeCloseTo(secondsAt(31), 9);
  });

  it("glides toward its target without overshoot and settles there", () => {
    expect(damp(0, 1, 0, 4)).toBe(0);
    const step = damp(0, 1, 0.25, 4);
    expect(step).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(damp(0, 1, 0.25)).toBe(step);
    expect(damp(1, 0, 0.25, 4)).toBeCloseTo(Math.exp(-1), 9);
    expect(damp(0, 1, 100, 4)).toBeCloseTo(1, 9);
    close(dampBox([0, 0, 0, 0], [1, 2, 3, 4], 0.25, 4), [step, 2 * step, 3 * step, 4 * step]);
    close(dampBox([0, 0, 0, 0], [1, 2, 3, 4], 0.25), [step, 2 * step, 3 * step, 4 * step]);
  });
});
