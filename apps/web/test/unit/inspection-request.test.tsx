import { afterEach, describe, expect, it } from "vitest";
import { draft } from "../../src/copy.ts";
import { fixFor, inspectionFor } from "../../src/router.ts";
import { fakePhone } from "./fakes.ts";
import { standIn, WALK } from "./fixed-fakes.ts";
import { callsTo, find, has, lines, mount, tap, until } from "./fixed-screen.tsx";

afterEach(() => {
  window.location.hash = "";
});

describe("the inspection request", () => {
  it("shows the subject, the words and the links once every Required Now item is Done", async () => {
    const state = standIn();
    const view = await mount(inspectionFor(WALK), state);
    await until(() => view.host.querySelector("main.inspection[data-ready=true]") !== null);
    expect(view.host.querySelector("h1")?.textContent).toBe(draft.inspection.title);
    expect(view.text()).toContain(draft.inspection.intro);
    expect(lines(view.host, "[data-part=subject]")).toEqual(["Subject: Inspection request"]);
    expect(lines(view.host, "[data-part=body]")).toEqual(["Please inspect my defensible space."]);
    const link = find<HTMLAnchorElement>(view.host, ".links a");
    expect([link.textContent, link.getAttribute("href"), link.getAttribute("target")]).toEqual(["Fire rules", "https://rules.example/a", "_blank"]);
    expect(find(view.host, "main a.button:last-of-type").getAttribute("href")).toBe(fixFor(WALK));
    expect(callsTo(state, "POST", `/api/walks/${WALK}/inspection-request`).length).toBeGreaterThan(0);
    await view.unmount();
  });

  it("copies the subject and the words with the Copy button and says it did", async () => {
    const { phone, copied } = fakePhone();
    const view = await mount(inspectionFor(WALK), standIn(), { phone });
    await until(() => has(view.host, draft.inspection.copy));
    await tap(view.host, draft.inspection.copy);
    expect(copied).toEqual(["Inspection request\n\nPlease inspect my defensible space."]);
    expect(view.text()).toContain(draft.inspection.copied);
    await view.unmount();
  });

  it("says when the copy did not work", async () => {
    const { phone } = fakePhone({ copy: async () => false });
    const view = await mount(inspectionFor(WALK), standIn(), { phone });
    await until(() => has(view.host, draft.inspection.copy));
    await tap(view.host, draft.inspection.copy);
    expect(view.text()).toContain(draft.inspection.copyFailed);
    expect(view.text()).not.toContain(draft.inspection.copied);
    await view.unmount();
  });

  it("says a Required Now item is still open in a fixed sentence, without the server's words, and offers no Copy", async () => {
    const state = standIn({ ready: false });
    const view = await mount(inspectionFor(WALK), state);
    await until(() => has(view.host, draft.fixed.backToFix, "a"));
    expect(view.host.querySelector("h1")?.textContent).toBe(draft.inspection.notReady);
    expect(view.text()).toContain(draft.fixed.problem("not_ready"));
    expect(view.text()).not.toContain("InspectionRefused");
    expect(view.text()).not.toContain("Move the wood pile");
    expect(has(view.host, draft.inspection.copy)).toBe(false);
    expect(view.host.querySelector("[data-part=body]")).toBeNull();
    expect(find(view.host, "a.button").getAttribute("href")).toBe(fixFor(WALK));
    await view.unmount();
  });

  it("says there is nothing to request when the walk has no Required Now item, and offers neither Copy nor Try Again", async () => {
    const message = "walk 00000000-0000-4000-8000-0000000a0001 has no Required Now item";
    const view = await mount(inspectionFor(WALK), standIn({ inspectionError: { status: 409, code: "conflict", message } }));
    await until(() => has(view.host, draft.fixed.backToFix, "a"));
    expect(view.text()).toContain(draft.inspection.noRequired);
    expect(view.text()).not.toContain(draft.fixed.problem("not_ready"));
    expect(view.text()).not.toContain(message);
    expect(has(view.host, draft.inspection.copy)).toBe(false);
    expect(has(view.host, draft.fixed.tryAgain)).toBe(false);
    await view.unmount();
  });

  it.each([
    [503, "server_error", "TypeError: Cannot read properties of undefined (reading 'id') at inspectionRequest (worker.js:12:3)"],
    [500, "boom", "D1_ERROR: no such column: walks.nope at /src/db.ts:44"],
    [429, "rate_limited", "RateLimited: approved email for this visitor today"],
  ])("never prints the server's error text: a %i %s is answered by the fixed sentence for its code", async (status, code, message) => {
    const view = await mount(inspectionFor(WALK), standIn({ inspectionError: { status, code, message } }));
    await until(() => has(view.host, draft.fixed.tryAgain));
    expect(view.text()).not.toContain(message);
    expect(view.host.querySelector(".problem")?.textContent).toBe(draft.fixed.problem(code === "boom" ? "server_error" : (code as "rate_limited")));
    await view.unmount();
  });

  it("says there is no signal and asks again on Try Again", async () => {
    const state = standIn({ offline: true });
    const view = await mount(inspectionFor(WALK), state);
    await until(() => has(view.host, draft.fixed.tryAgain));
    expect(view.text()).toContain(draft.fixed.problem("offline"));
    state.offline = false;
    await tap(view.host, draft.fixed.tryAgain);
    await until(() => view.host.querySelector("main.inspection[data-ready=true]") !== null);
    await view.unmount();
  });
});
