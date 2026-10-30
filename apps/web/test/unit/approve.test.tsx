import { afterEach, describe, expect, it } from "vitest";
import { draft } from "../../src/copy.ts";
import { approveFor, fixFor, ROUTES } from "../../src/router.ts";
import { fakePhone } from "./fakes.ts";
import { C1, C3, crew, J1, job, jobsView, M1, M2, M7, message, photo, standIn, WALK } from "./fixed-fakes.ts";
import { callsTo, find, has, lines, mount, tap, until } from "./fixed-screen.tsx";
import { settle } from "./render.ts";

afterEach(() => {
  window.location.hash = "";
});

const JPEG = async () => new Blob(["pixels"], { type: "image/jpeg" });

const EMAIL = { body: "Hello, could you look at the oak over my roof?" };
const email = () => message(M1, C1, { photos: [photo(1), photo(2)] });

const TEXT = { body: "Hi, could you look at a tree? Photos attached." };
const text = () => message(M2, C3, { channel: "text", subject: null, body: TEXT.body, photos: [photo(1)] });

const state = (messages = [email(), text()]) =>
  standIn({ view: jobsView([job(J1, { crews: [crew(C1), crew(C3, { name: "Texting Crew", email: null })], messages })]) });

const opened = async (id: string, over: Parameters<typeof mount>[2] = {}, from = state()) => {
  const view = await mount(approveFor(WALK, id), from, { stills: JPEG, ...over });
  await until(() => view.host.querySelector("main.approve h2") !== null || view.text().includes(draft.approve.missing));
  return { ...view, state: from };
};

describe("Approve, an email", () => {
  it("shows the crew, where it goes, the subject, the words and each proof photo, and says nothing is sent until the tap", async () => {
    const view = await opened(M1);
    expect(view.host.querySelector("h1")?.textContent).toBe(draft.approve.title);
    expect(view.host.querySelector("main h2")?.textContent).toBe("Crew c1");
    expect(lines(view.host, "[data-part=channel]")).toEqual(["This goes by email to c1@crews.example."]);
    expect(lines(view.host, "[data-part=subject]")).toEqual(["Subject: Tree work near my house"]);
    expect(lines(view.host, "[data-part=body]")).toEqual([EMAIL.body]);
    await until(() => view.host.querySelectorAll(".photos img").length === 2);
    expect(view.text()).toContain(draft.approve.nothingSent);
    expect(callsTo(view.state, "POST", `/api/messages/${M1}/approve`)).toHaveLength(0);
    expect(callsTo(view.state, "POST", `/api/messages/${M1}/sent-by-phone`)).toHaveLength(0);
    await view.unmount();
  });

  it("sends nothing until Approve and Send is tapped, then approves once and says it was sent", async () => {
    const view = await opened(M1);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(view.state.calls.filter((c) => c.method === "POST")).toEqual([]);
    await tap(view.host, draft.approve.email);
    await until(() => view.text().includes(draft.approve.sentEmail));
    expect(callsTo(view.state, "POST", `/api/messages/${M1}/approve`)).toHaveLength(1);
    expect(has(view.host, draft.approve.email)).toBe(false);
    expect(view.text()).not.toContain(draft.approve.nothingSent);
    expect(view.state.view.jobs[0]!.messages[0]!.status).toBe("sent");
    await view.unmount();
  });

  it("shows a retry when the mail service failed, and approving again sends it", async () => {
    const failing = state();
    failing.sendFails = true;
    const view = await opened(M1, {}, failing);
    await tap(view.host, draft.approve.email);
    await until(() => view.text().includes(draft.approve.sendFailed));
    expect(has(view.host, draft.approve.again)).toBe(true);
    expect(view.text()).not.toContain(draft.approve.sentEmail);
    view.state.sendFails = false;
    await tap(view.host, draft.approve.again);
    await until(() => view.text().includes(draft.approve.sentEmail));
    expect(callsTo(view.state, "POST", `/api/messages/${M1}/approve`)).toHaveLength(2);
    expect(view.text()).not.toContain(draft.approve.sendFailed);
    await view.unmount();
  });

  it("says there is no signal when the approval cannot reach the server", async () => {
    const view = await opened(M1);
    view.state.offline = true;
    await tap(view.host, draft.approve.email);
    await until(() => view.text().includes(draft.fixed.problem("offline")));
    expect(has(view.host, draft.approve.email)).toBe(true);
    await view.unmount();
  });

  it("shows a request already sent as sent, with no button to send it again", async () => {
    const sent = message(M1, C1, { status: "sent", sentAt: "2026-10-29T19:00:00.000Z" });
    const view = await opened(M1, {}, state([sent]));
    expect(lines(view.host, "[data-part=state]")).toEqual(["Sent on Oct. 29th, 2026."]);
    expect(has(view.host, draft.approve.email)).toBe(false);
    expect(view.text()).not.toContain(draft.approve.nothingSent);
    await view.unmount();
  });

  it("says the request cannot be found and links back to Get It Fixed", async () => {
    const view = await opened("nope");
    expect(view.text()).toContain(draft.approve.missing);
    expect(find(view.host, "a.button").getAttribute("href")).toBe(fixFor(WALK));
    await view.unmount();
  });

  it("sends a bare approval address home", async () => {
    const view = await mount(ROUTES.approve, standIn());
    await until(() => view.host.querySelector("main.approve") === null);
    await view.unmount();
  });
});

describe("Approve, a text", () => {
  const sms = (body: string) => `sms:+12095550101?&body=${encodeURIComponent(body)}`;

  const approved = async (phone: ReturnType<typeof fakePhone>["phone"], over: Parameters<typeof mount>[2] = {}) => {
    const view = await opened(M2, { phone, ...over });
    await tap(view.host, draft.approve.text);
    await until(() => has(view.host, draft.approve.openText));
    return view;
  };

  it("approves with one tap, shares nothing yet, then says the text still has to be opened", async () => {
    const { phone, shared, opened: smsOpened } = fakePhone({ canShareFiles: () => true });
    const view = await opened(M2, { phone });
    expect(lines(view.host, "[data-part=channel]")).toEqual(["This is sent by text from your phone to +12095550101."]);
    expect(view.host.querySelector("[data-part=subject]")).toBeNull();
    expect(has(view.host, draft.approve.openText)).toBe(false);
    await tap(view.host, draft.approve.text);
    await until(() => has(view.host, draft.approve.openText));
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/approve`)).toHaveLength(1);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/sent-by-phone`)).toHaveLength(0);
    expect(shared).toEqual([]);
    expect(smsOpened).toEqual([]);
    expect(lines(view.host, "main > p:not([data-part])")).toContain(draft.approve.approvedText);
    expect(view.text()).not.toContain(draft.approve.nothingSent);
    expect(has(view.host, draft.approve.text)).toBe(false);
    await view.unmount();
  });

  it("shares the photos and the words from the Open the Text tap, then tells the server it was sent by phone", async () => {
    const { phone, shared, opened: smsOpened } = fakePhone({ canShareFiles: () => true });
    const view = await approved(phone);
    await tap(view.host, draft.approve.openText);
    await until(() => view.text().includes(draft.approve.sentPhone));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.text).toBe(TEXT.body);
    expect(shared[0]!.files.map((f) => [f.name, f.type])).toEqual([["photo-1.jpg", "image/jpeg"]]);
    expect(smsOpened).toEqual([]);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/approve`)).toHaveLength(1);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/sent-by-phone`)).toHaveLength(1);
    expect(view.state.view.jobs[0]!.messages[1]!.status).toBe("sent_by_phone");
    expect(has(view.host, draft.approve.openText)).toBe(false);
    await view.unmount();
  });

  it("opens Messages with the text when files cannot be shared, then tells the server it was sent by phone", async () => {
    const { phone, shared, opened: smsOpened } = fakePhone({ canShareFiles: () => false });
    const view = await approved(phone);
    await tap(view.host, draft.approve.openText);
    await until(() => view.text().includes(draft.approve.sentPhone));
    expect(smsOpened).toEqual([sms(TEXT.body)]);
    expect(shared).toEqual([]);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/sent-by-phone`)).toHaveLength(1);
    await view.unmount();
  });

  it("opens Messages when no photo could be fetched, even if the phone could share files", async () => {
    const { phone, shared, opened: smsOpened } = fakePhone({ canShareFiles: () => true });
    const view = await approved(phone, { stills: async () => null });
    await tap(view.host, draft.approve.openText);
    await until(() => view.text().includes(draft.approve.sentPhone));
    expect(shared).toEqual([]);
    expect(smsOpened).toEqual([sms(TEXT.body)]);
    await view.unmount();
  });

  it("does not share or open anything when the approval did not reach the server", async () => {
    const { phone, shared, opened: smsOpened } = fakePhone({ canShareFiles: () => true });
    const view = await opened(M2, { phone });
    view.state.offline = true;
    await tap(view.host, draft.approve.text);
    await until(() => view.text().includes(draft.fixed.problem("offline")));
    expect(has(view.host, draft.approve.openText)).toBe(false);
    expect(shared).toEqual([]);
    expect(smsOpened).toEqual([]);
    await view.unmount();
  });

  it("offers Open the Text for a text that was approved earlier, without approving again", async () => {
    const earlier = message(M2, C3, { channel: "text", subject: null, body: TEXT.body, status: "approved", photos: [photo(1)] });
    const { phone, shared } = fakePhone({ canShareFiles: () => true });
    const view = await opened(M2, { phone }, state([earlier]));
    expect(has(view.host, draft.approve.text)).toBe(false);
    await tap(view.host, draft.approve.openText);
    await until(() => view.text().includes(draft.approve.sentPhone));
    expect(shared).toHaveLength(1);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/approve`)).toHaveLength(0);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/sent-by-phone`)).toHaveLength(1);
    await view.unmount();
  });

  it("does not tell the server it was sent when the share sheet is closed, and lets the homeowner open it again", async () => {
    const { phone, opened: smsOpened } = fakePhone({
      canShareFiles: () => true,
      share: async () => {
        throw Object.assign(new Error("Share canceled"), { name: "AbortError" });
      },
    });
    const view = await approved(phone);
    await tap(view.host, draft.approve.openText);
    await until(() => view.text().includes(draft.approve.notSent));
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/sent-by-phone`)).toHaveLength(0);
    expect(smsOpened).toEqual([]);
    expect(has(view.host, draft.approve.openText)).toBe(true);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/approve`)).toHaveLength(1);
    expect(view.text()).not.toContain(draft.approve.sentPhone);
    expect(view.text()).not.toContain(draft.approve.approvedText);
    await view.unmount();
  });

  it("falls back to Messages when the share sheet fails for another reason", async () => {
    const { phone, opened: smsOpened } = fakePhone({
      canShareFiles: () => true,
      share: async () => {
        throw new Error("NotAllowedError");
      },
    });
    const view = await approved(phone);
    await tap(view.host, draft.approve.openText);
    await until(() => view.text().includes(draft.approve.sentPhone));
    expect(smsOpened).toEqual([sms(TEXT.body)]);
    await view.unmount();
  });

  it("offers to tell the server again, without sharing again, when the sent by phone note did not get through", async () => {
    const { phone, shared } = fakePhone({ canShareFiles: () => true });
    const view = await approved(phone);
    const original = view.deps.fixed.sentByPhone;
    view.deps.fixed.sentByPhone = async () => ({ code: "offline", message: "" });
    await tap(view.host, draft.approve.openText);
    await until(() => has(view.host, draft.approve.markAgain));
    expect(shared).toHaveLength(1);
    expect(view.text()).not.toContain(draft.approve.approvedText);
    view.deps.fixed.sentByPhone = original;
    await tap(view.host, draft.approve.markAgain);
    await until(() => view.text().includes(draft.approve.sentPhone));
    expect(shared).toHaveLength(1);
    expect(callsTo(view.state, "POST", `/api/messages/${M2}/approve`)).toHaveLength(1);
    await view.unmount();
  });
});

describe("Approve, a reminder", () => {
  it("opens a follow up draft for approval like any other request", async () => {
    const reminder = message(M7, C1, { subject: "Checking in", body: "Just checking in on my request.", photos: [] });
    const view = await opened(M7, {}, state([email(), reminder]));
    expect(lines(view.host, "[data-part=subject]")).toEqual(["Subject: Checking in"]);
    expect(view.host.querySelector(".proofs")).toBeNull();
    await tap(view.host, draft.approve.email);
    await until(() => view.text().includes(draft.approve.sentEmail));
    await view.unmount();
  });
});
