import { PropertyEntry } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { DepsContext } from "../../src/deps.ts";
import { portfolioWords as w } from "../../src/draft-words.ts";
import { fixFor } from "../../src/router.ts";
import { SAMPLE_HOMES, samplePortfolio } from "../../src/samples/portfolio.ts";
import { Homes } from "../../src/screens/Homes.tsx";
import { Property } from "../../src/screens/Property.tsx";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 80 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const shown = (screen: React.JSX.Element) => render(<DepsContext.Provider value={testDeps({ portfolio: samplePortfolio })}>{screen}</DepsContext.Provider>);

describe("the judge copy's sample portfolio", () => {
  it("every home passes the contract and is marked as a sample, with all three statuses", () => {
    for (const home of SAMPLE_HOMES) {
      expect(PropertyEntry.safeParse(home).success, home.label).toBe(true);
      expect(home.synthetic).toBe(true);
      expect(home.label).toMatch(/^Sample: /);
    }
    expect(new Set(SAMPLE_HOMES.map((home) => home.status))).toEqual(new Set(["not_walked", "needs_work", "ready"]));
  });

  it("Your Homes lists them with the sample line and no way to add one", async () => {
    const view = await shown(<Homes />);
    await until(() => view.host.querySelectorAll("li[data-home]").length === SAMPLE_HOMES.length);
    expect(view.text()).toContain(w.sampleLine);
    expect(view.host.querySelector("form")).toBeNull();
    await view.unmount();
  });

  it("a sample Property is read only: no invite, walk, record, mark or Get It Fixed", async () => {
    const home = SAMPLE_HOMES.find((h) => h.status === "needs_work")!;
    const view = await shown(<Property propertyId={home.id} />);
    await until(() => view.text().includes(home.label));
    expect(view.text()).toContain(w.sampleLine);
    expect(view.host.querySelector("button")).toBeNull();
    const hrefs = [...view.host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain(fixFor(home.walks[0]!.walkId));
    expect(hrefs.filter((href) => href?.includes("record") || href?.includes("invite"))).toEqual([]);
    expect(view.text()).toContain(w.openHeading);
    await view.unmount();
  });

  it("changes nothing when asked", async () => {
    expect((await samplePortfolio.add("x")).code).toBeDefined();
    expect((await samplePortfolio.invite(SAMPLE_HOMES[0]!.id)).code).toBeDefined();
    expect((await samplePortfolio.markDone("x", "2026-10-30")).code).toBeDefined();
  });
});
