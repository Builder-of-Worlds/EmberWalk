import { afterEach, describe, expect, it } from "vitest";
import { draft } from "../../src/copy.ts";
import { fixedApi } from "../../src/fixed-api.ts";
import { approveFor, fixFor, ROUTES } from "../../src/router.ts";
import { C1, J1, job, jobsView, M1, message, standIn, standInFetch, WALK } from "./fixed-fakes.ts";
import type { StandIn } from "./fixed-fakes.ts";
import { mount, until } from "./fixed-screen.tsx";
import { settle } from "./render.ts";

afterEach(() => {
  window.location.hash = "";
});

const held = (state: StandIn) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = standInFetch(state);
  return { release, fixed: fixedApi("https://ember.test", async (request) => (await gate, send(request)), () => "v") };
};

const SCREENS: [string, string, StandIn, (host: HTMLElement) => boolean][] = [
  ["Get It Fixed", fixFor(WALK), standIn(), (host) => host.querySelector("form") !== null],
  ["the record", ROUTES.history, standIn(), (host) => host.textContent?.includes(draft.history.empty) === true],
  ["Approve", approveFor(WALK, M1), standIn({ view: jobsView([job(J1, { crews: [{ ...job(J1).crews[0]!, id: C1 }], messages: [message(M1, C1)] })]) }), (host) => host.querySelector("main.approve h2") !== null],
];

describe.each(SCREENS)("%s while its first fetch is in flight", (_name, hash, state, arrived) => {
  it("shows the loading line before the answer arrives and not after", async () => {
    const wait = held(state);
    const view = await mount(hash, state, { fixed: wait.fixed });
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(view.text()).toContain(draft.fixed.loading);
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(draft.fixed.loading);
    wait.release();
    await until(() => arrived(view.host));
    expect(view.text()).not.toContain(draft.fixed.loading);
    await view.unmount();
  });
});
