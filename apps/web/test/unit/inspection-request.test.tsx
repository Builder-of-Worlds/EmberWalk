import { afterEach, describe, expect, it } from "vitest";
import { draft, shortDay } from "../../src/copy.ts";
import { inspectionWords } from "../../src/draft-words.ts";
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

  describe("Email The Department", () => {
    const MESSAGE = "fa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
    const CONTACT = { agency: "Test Fire District", email: "inspect@fire.example", source: "https://fire.example/inspections", readOn: "2026-10-31" };
    const withContact = (over: Partial<ReturnType<typeof standIn>["inspection"]> = {}) => {
      const state = standIn();
      state.inspection = { ...state.inspection, contact: CONTACT, messageId: MESSAGE, ...over };
      return state;
    };
    const ready = async (state: ReturnType<typeof standIn>) => {
      const view = await mount(inspectionFor(WALK), state);
      await until(() => view.host.querySelector("main.inspection[data-ready=true]") !== null);
      return view;
    };

    it("names the department, links its source with the date it was read, and sends only on the tap", async () => {
      const state = withContact();
      const view = await ready(state);
      expect(lines(view.host, "[data-part=department]")).toEqual([inspectionWords.goesTo(CONTACT.agency, CONTACT.email)]);
      const source = find<HTMLAnchorElement>(view.host, "a[data-part=source]");
      expect([source.textContent, source.getAttribute("href"), source.getAttribute("target")]).toEqual([inspectionWords.source, CONTACT.source, "_blank"]);
      expect(lines(view.host, "[data-part=read-on]")).toEqual([inspectionWords.readOn(shortDay(CONTACT.readOn))]);
      expect(callsTo(state, "POST", `/api/inspections/${MESSAGE}/approve`)).toEqual([]);
      await tap(view.host, inspectionWords.email);
      expect(callsTo(state, "POST", `/api/inspections/${MESSAGE}/approve`)).toHaveLength(1);
      expect(view.text()).toContain(inspectionWords.sent(CONTACT.agency));
      expect(has(view.host, inspectionWords.email)).toBe(false);
      await view.unmount();
    });

    it("offers no email where no department lists one", async () => {
      const view = await ready(standIn());
      expect(has(view.host, inspectionWords.email)).toBe(false);
      expect(view.host.querySelector("[data-part=department]")).toBeNull();
      expect(view.text()).toContain(draft.inspection.copy);
      await view.unmount();
    });

    it("says when the email did not go, and offers the tap again", async () => {
      const state = withContact();
      state.inspectionSendFails = true;
      const view = await ready(state);
      await tap(view.host, inspectionWords.email);
      expect(view.text()).toContain(draft.approve.sendFailed);
      expect(has(view.host, inspectionWords.email)).toBe(true);
      await view.unmount();
    });

    it("shows it was sent and what the department answered when the request is opened again", async () => {
      const view = await ready(withContact({ sent: true, replies: [{ id: MESSAGE, text: "We can come Thursday.", receivedAt: "2026-11-01T10:00:00.000Z" }] }));
      expect(has(view.host, inspectionWords.email)).toBe(false);
      expect(view.text()).toContain(inspectionWords.sent(CONTACT.agency));
      expect(lines(view.host, "[data-part=department-reply]")).toEqual(["We can come Thursday."]);
      await view.unmount();
    });
  });

  describe("Open CAL FIRE Form", () => {
    it("opens CAL FIRE's own inspection request form in a new tab once the request is ready", async () => {
      const view = await mount(inspectionFor(WALK), standIn());
      await until(() => view.host.querySelector("main.inspection[data-ready=true]") !== null);
      const form = find<HTMLAnchorElement>(view.host, "a[data-part=calfire-form]");
      expect([form.textContent, form.getAttribute("href"), form.getAttribute("target"), form.className]).toEqual([
        inspectionWords.openForm,
        "https://survey123.arcgis.com/share/a15c7706b4114e20b39d2a26294338ed",
        "_blank",
        "button",
      ]);
      await view.unmount();
    });
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
