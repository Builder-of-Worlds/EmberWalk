import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const entry = new URL("../src/index.ts", import.meta.url).href;
const script = `
const rules = await import(${JSON.stringify(entry)});
const found = rules.lookup({ concept: "wood_pile", distanceFeet: { low: 2, high: 2 }, contact: "no", plantState: null, spacing: null, flags: [] }, "ca");
let reason = null;
try { rules.lookup({ concept: "wood_pile", distanceFeet: { low: 2, high: 2 }, contact: "no", plantState: null, spacing: null, flags: [] }, "nv"); } catch (error) { reason = error.reason; }
console.log(JSON.stringify({ states: rules.loadedStates().map((s) => s.state), first: found[0]?.id ?? null, reason }));
`;

describe("the package under plain node, with types stripped and no loader", () => {
  it("loads, looks up a California rule and refuses an unloaded state, as blender's load_rules runs it", () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", env });
    expect(run.stderr).not.toMatch(/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|SyntaxError/);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ states: ["CA"], first: "ca-wood-pile-uncovered-ccr-z0", reason: "not_loaded" });
  });
});
