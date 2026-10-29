import { afterEach, describe, expect, it } from "vitest";

const scope = globalThis as unknown as Record<string, unknown>;
let run = 0;

async function boot(reduce: boolean) {
  const classes: string[] = [];
  const queries: string[] = [];
  scope.matchMedia = (query: string) => (queries.push(query), { matches: reduce });
  scope.document = { documentElement: { classList: { add: (name: string) => classes.push(name) } } };
  run += 1;
  await import(/* @vite-ignore */ `../../public/boot.js?run=${run}`);
  return { classes, queries };
}

afterEach(() => {
  delete scope.matchMedia;
  delete scope.document;
});

describe("boot.js", () => {
  it("marks the page for motion before it paints when motion is allowed", async () => {
    expect(await boot(false)).toEqual({ classes: ["js"], queries: ["(prefers-reduced-motion: reduce)"] });
  });

  it("leaves the page unmarked, so every line shows at once, when the visitor asks for less motion", async () => {
    expect(await boot(true)).toEqual({ classes: [], queries: ["(prefers-reduced-motion: reduce)"] });
  });
});
