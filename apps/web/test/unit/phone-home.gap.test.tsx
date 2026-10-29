import { describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { testDeps } from "./fakes.ts";
import { render } from "./render.ts";

const nameOf = (el: Element): string => {
  const named = [el.getAttribute("aria-label"), el.getAttribute("alt"), el.querySelector("title")?.textContent];
  return named.find((n) => n !== null && n !== undefined && n.trim() !== "")?.trim() ?? "";
};

describe("Home gaps", () => {
  it('brand mark: a green shield in three layers with WILDFIRE HOME CHECK underneath', async () => {
    window.location.hash = "";
    const view = await render(<App deps={testDeps()} />);
    const main = view.host.querySelector("main");
    const marks = [...(main?.querySelectorAll("img, svg, [role=img]") ?? [])].filter(
      (el) => (el.tagName !== "svg" || el.getAttribute("role") === "img") && /emberwalk/i.test(nameOf(el)),
    );
    expect(marks.length, "the shield mark named for EmberWalk on Home").toBeGreaterThan(0);
    const lockup = [main?.textContent ?? "", ...[...(main?.querySelectorAll("img, svg, [role=img]") ?? [])].map(nameOf)];
    expect(lockup.some((said) => /wildfire home check/i.test(said)), "the lockup line under the name").toBe(true);
    await view.unmount();
  });
});
