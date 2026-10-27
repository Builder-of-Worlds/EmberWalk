import { POINT_TARGETS, samBoxText, samBoxVideoCall } from "@emberwalk/meta";
import answers from "../../../fixtures/meta/box-probe-test-yard-2-answers.json";
import rows from "../../../fixtures/meta/box-probe-test-yard-2-rows.json";
import { harness } from "./harness.ts";

type Row = { hazard: string; frame: number; grid: Rect; pixels: Rect; sparkFingerprint: string; samFingerprint: string };
export type Rect = { left: number; top: number; right: number; bottom: number };

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FRAMES = 40;
export const FPS = 2;
export const NOT_FOUND = '{"found": false, "box": null}';
const passOne = (rows as unknown as Row[][])[0] as Row[];

export const rowAt = (hazard: string, frame: number): Row => {
  const row = passOne.find((r) => r.hazard === hazard && r.frame === frame);
  if (row === undefined) throw new Error(`no recorded row for ${hazard} at ${frame}`);
  return row;
};

export const recorded = (fingerprint: string): unknown => (answers as Record<string, unknown>)[`pass1-${fingerprint}`];

export const textOf = (body: unknown): string =>
  (body as { output: { type: string; content?: { text: string }[] }[] }).output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text)
    .join("");

export const BRUSH = [rowAt("dry-brush-1", 20), rowAt("dry-brush-1", 28)] as const;
export const FENCE = [rowAt("fence-joint-1", 28), rowAt("fence-joint-1", 36)] as const;

export const asking = (concept: "dry brush" | "wooden fence"): string => `Find the ${POINT_TARGETS[concept]}.`;

export const samAsk = (row: Row): string => samBoxText({ frame: row.frame, frameWidth: WIDTH, frameHeight: HEIGHT, boxes: [{ id: 1, ...row.pixels }] });

const stageSpark = (concept: "dry brush" | "wooden fence", seen: readonly Row[]): void => {
  harness.answers[asking(concept)] = [{ text: NOT_FOUND }];
  for (const row of seen) harness.answers[`${asking(concept)}#${row.frame}`] = [{ text: textOf(recorded(row.sparkFingerprint)) }];
};

export const stageSam = (row: Row): void => {
  harness.answers[samAsk(row)] = [{ text: textOf(recorded(row.samFingerprint)) }];
};

export const stageRecorded = (): void => {
  stageSpark("dry brush", BRUSH);
  stageSpark("wooden fence", FENCE);
  stageSam(BRUSH[0]);
  stageSam(FENCE[1]);
};

export const framesOf = (row: Row): number[] =>
  samBoxVideoCall({ video: { fileId: "x" }, prompts: { frame: row.frame, frameWidth: WIDTH, frameHeight: HEIGHT, boxes: [{ id: 1, ...row.pixels }] }, frames: FRAMES, content: "synthetic" })
    .read(recorded(row.samFingerprint))
    .frames.map((f) => f.frame);

