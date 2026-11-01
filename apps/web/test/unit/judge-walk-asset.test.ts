// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import render from "../../../../fixtures/synthetic/test-yard-2/import/render.json";
import { judgeWalkPlugin } from "../../build/judge-walk.ts";
import { JUDGE_WALK_FILE } from "../../src/judge.ts";

type Emitted = { type: string; fileName: string; source: Uint8Array };

const emitted = (): Emitted[] => {
  const files: Emitted[] = [];
  const hook = judgeWalkPlugin().generateBundle as (this: { emitFile: (file: Emitted) => void }) => void;
  hook.call({ emitFile: (file) => files.push(file) });
  return files;
};

describe("the walk the judge build carries", () => {
  it("is the one sample walk render.json describes, byte for byte", () => {
    const [walk, ...rest] = emitted();
    expect(rest).toEqual([]);
    expect(walk?.fileName).toBe(JUDGE_WALK_FILE);
    expect(walk?.source.byteLength).toBe(render.size_bytes);
    expect(createHash("sha256").update(walk!.source).digest("hex")).toBe(render.sha256);
  });
});
