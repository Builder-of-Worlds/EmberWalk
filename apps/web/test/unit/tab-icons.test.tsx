import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { PORTFOLIO_KEY, shellWords } from "../../src/draft-words.ts";
import { ROUTES } from "../../src/router.ts";
import { testDeps } from "./fakes.ts";
import { render } from "./render.ts";

const barOf = async () => {
  window.location.hash = ROUTES.settings;
  const view = await render(<App deps={testDeps()} />);
  const tabs = [...view.host.querySelectorAll(".tabs a")].map((a) => {
    const icons = [...a.querySelectorAll("svg")];
    return { tab: a.getAttribute("data-tab"), icon: icons.map((svg) => svg.getAttribute("data-icon")).join(), hidden: icons.every((svg) => svg.getAttribute("aria-hidden") === "true"), name: a.textContent };
  });
  await view.unmount();
  return tabs;
};

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

describe("the tab bar", () => {
  it("draws a walking figure for Walks, a wrench for Fixes and a gear for Settings, each named by its label alone", async () => {
    expect(await barOf()).toEqual([
      { tab: "home", icon: "house", hidden: true, name: shellWords.home },
      { tab: "walks", icon: "walker", hidden: true, name: shellWords.walks },
      { tab: "fixes", icon: "wrench", hidden: true, name: shellWords.fixes },
      { tab: "settings", icon: "gear", hidden: true, name: shellWords.settings },
    ]);
  });

  it("keeps the two houses for a landlord's Homes tab", async () => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    expect((await barOf()).map(({ tab, icon }) => [tab, icon])).toEqual([
      ["home", "house"],
      ["walks", "walker"],
      ["homes", "houses"],
      ["settings", "gear"],
    ]);
  });
});
