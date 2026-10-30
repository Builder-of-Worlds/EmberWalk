import { FIXED_ROUTE_CODES } from "@emberwalk/shared";
import { afterEach, describe, expect, it } from "vitest";
import { copy, draft } from "../../src/copy.ts";
import { approveFor, fixFor, inspectionFor, resultsFor, ROUTES } from "../../src/router.ts";
import { C1, C2, C9, crew, draftId, F1, F2, F3, J1, job, jobsView, M1, M2, M3, M4, M5, M6, M7, M9, message, R1, R2, standIn, WALK } from "./fixed-fakes.ts";
import { callsTo, find, has, lines, mount, named, RESULTS, tap, typeInto, until } from "./fixed-screen.tsx";
import { settle } from "./render.ts";
import { liveFindingId } from "./result-fakes.ts";

afterEach(() => {
  window.location.hash = "";
});

const HONEST = "Every licensed business on California's public contractor list, closest first. EmberWalk doesn't rank or recommend them.";

const planned = async (state = standIn({ view: jobsView([job(J1)]) })) => {
  const view = await mount(fixFor(WALK), state);
  await until(() => view.host.querySelector("section.job") !== null);
  return { ...view, state };
};

describe("Get It Fixed, asking for a ZIP code", () => {
  it("asks for a ZIP code when nothing is planned, refuses one that is not five digits, then lists the crews", async () => {
    const state = standIn();
    const view = await mount(fixFor(WALK), state);
    await until(() => view.host.querySelector("#zip") !== null);
    expect(view.host.querySelector("h1")?.textContent).toBe(draft.fixed.title);
    expect(view.text()).toContain(draft.fixed.nothingGoesOut);
    await typeInto(find<HTMLInputElement>(view.host, "#zip"), "9537");
    await tap(view.host, draft.fixed.zipButton);
    expect(view.text()).toContain(draft.fixed.zipInvalid);
    expect(callsTo(state, "POST", `/api/walks/${WALK}/get-it-fixed`)).toHaveLength(0);
    await typeInto(find<HTMLInputElement>(view.host, "#zip"), "95370");
    await tap(view.host, draft.fixed.zipButton);
    await until(() => view.host.querySelector("section.job") !== null);
    expect(callsTo(state, "POST", `/api/walks/${WALK}/get-it-fixed`)[0]?.body).toEqual({ zip: "95370" });
    expect(view.host.querySelector("#zip")).toBeNull();
    expect(lines(view.host, "section.job h2")).toEqual([draft.fixed.trade.tree_service]);
    await view.unmount();
  });

  it("says something went wrong when the server does not hold the walk, and plans nothing", async () => {
    const state = standIn();
    const other = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99";
    const view = await mount(fixFor(other), state, { results: async () => RESULTS });
    await until(() => view.host.querySelector("#zip") !== null);
    await typeInto(find<HTMLInputElement>(view.host, "#zip"), "95370");
    await tap(view.host, draft.fixed.zipButton);
    await until(() => view.text().includes(draft.fixed.problem("not_found")));
    expect(view.host.querySelector("section.job")).toBeNull();
    expect(state.view.jobs).toEqual([]);
    await view.unmount();
  });

  it("says there is no signal and offers Try Again, which asks again", async () => {
    const state = standIn({ offline: true });
    const view = await mount(fixFor(WALK), state);
    await until(() => has(view.host, draft.fixed.tryAgain));
    expect(view.text()).toContain(draft.fixed.problem("offline"));
    state.offline = false;
    state.view = jobsView([job(J1)]);
    await tap(view.host, draft.fixed.tryAgain);
    await until(() => view.host.querySelector("section.job") !== null);
    await view.unmount();
  });

  it("treats a jobs answer that is off the contract as a problem and renders none of it", async () => {
    const state = standIn({ view: jobsView([job(J1, { crews: [crew(C1, { phone: "2095550101" })] })]) });
    const view = await mount(fixFor(WALK), state);
    await until(() => has(view.host, draft.fixed.tryAgain));
    expect(view.text()).toContain(draft.fixed.problem("server_error"));
    expect(view.host.querySelector("section.job")).toBeNull();
    expect(view.host.querySelector("[data-crew]")).toBeNull();
    await view.unmount();
  });

  it("has a plain sentence for every code the Get It Fixed routes send and for no signal, none of them a bare code", () => {
    for (const code of [...FIXED_ROUTE_CODES, "offline" as const]) {
      const words = draft.fixed.problem(code);
      expect([code, words.length > 10]).toEqual([code, true]);
      expect(words).not.toContain("_");
    }
    const generic = draft.fixed.problem("server_error");
    for (const code of ["conflict", "not_ready", "send_failed", "not_found", "invalid_request", "rate_limited", "offline"] as const) expect(draft.fixed.problem(code)).not.toBe(generic);
  });

  it("sends a bare Get It Fixed address home", async () => {
    window.location.hash = ROUTES.fix;
    const view = await mount(ROUTES.fix, standIn());
    await until(() => window.location.hash === ROUTES.home || view.host.querySelector("h1")?.textContent === copy.home.title);
    await view.unmount();
  });
});

describe("Get It Fixed, the crews", () => {
  it("shows the ruled line above the list, the nothing goes out line, and one job per trade with the findings it covers", async () => {
    const view = await planned();
    expect(view.text()).toContain(HONEST);
    expect(view.text()).toContain(draft.fixed.nothingGoesOut);
    const honest = find(view.host, "p.lead");
    expect(honest.compareDocumentPosition(find(view.host, "ul.crews")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lines(view.host, "section.job .sentences li")).toEqual(["Move the wood pile."]);
    expect(view.text()).toContain(draft.fixed.itemsOnList(1));
    expect(view.text()).toContain(draft.fixed.job.planning);
    await view.unmount();
  });

  it("shows each crew's name, class, distance, license status with its list date, and Call, Text and Check This License", async () => {
    const view = await planned();
    const first = find(view.host, `[data-crew=${C1}]`);
    expect(first.querySelector("h3")?.textContent).toBe("Crew c1");
    expect(lines(first, "[data-part=class]")).toEqual(["Tree and Palm Contractor (C-49)"]);
    expect(lines(first, "[data-part=distance]")).toEqual(["2.3 miles away"]);
    expect(lines(first, "[data-part=license]")).toEqual(["License status CLEAR on the state list of Oct. 28th, 2026"]);
    const call = named(first, "Call", "a");
    expect(call.getAttribute("href")).toBe("tel:+12095550101");
    expect(named(first, "Text", "a").getAttribute("href")).toBe("sms:+12095550101");
    const check = named(first, "Check This License", "a");
    expect(check.getAttribute("href")).toBe(`https://license.example/${C1}`);
    expect(check.getAttribute("target")).toBe("_blank");
    expect(check.getAttribute("rel")).toContain("noreferrer");
    await view.unmount();
  });

  it("says about for an approximate distance, hides Call and Text without a phone and the license button without a link", async () => {
    const view = await planned();
    const second = find(view.host, `[data-crew=${C2}]`);
    expect(lines(second, "[data-part=distance]")).toEqual(["about 4 miles away"]);
    expect(has(second, "Call", "a")).toBe(false);
    expect(has(second, "Text", "a")).toBe(false);
    expect(has(second, "Check This License", "a")).toBe(false);
    await view.unmount();
  });

  it("marks a sample crew and leaves out what the crew does not have", async () => {
    const bare = crew(C9, { sample: true, className: null, licenseStatus: null, distanceMiles: null });
    const view = await planned(standIn({ view: jobsView([job(J1, { crews: [bare] })]) }));
    const card = find(view.host, `[data-crew=${C9}]`);
    expect(lines(card, "[data-part=sample]")).toEqual(["Sample crew"]);
    for (const part of ["class", "distance", "license"]) expect(card.querySelector(`[data-part=${part}]`), part).toBeNull();
    await view.unmount();
  });

  it("says when no licensed crew was found for a trade", async () => {
    const view = await planned(standIn({ view: jobsView([job(J1, { crews: [] })]) }));
    expect(view.text()).toContain(draft.fixed.noCrews);
    expect(has(view.host, draft.fixed.writeRequests)).toBe(false);
    expect(view.text()).not.toContain(HONEST);
    await view.unmount();
  });

  it("lists what no crew covers as the homeowner's own work", async () => {
    const view = await planned(standIn({ view: jobsView([job(J1)], [liveFindingId(2)]) }));
    expect(lines(view.host, "section.yourself h2")).toEqual([draft.fixed.yourself]);
    expect(lines(view.host, "section.yourself li")).toEqual(["Clear the dry brush."]);
    await view.unmount();
  });

  it("offers the inspection request and a way back to the results", async () => {
    const view = await planned();
    expect(named(view.host, draft.fixed.inspection, "a").getAttribute("href")).toBe(inspectionFor(WALK));
    expect(view.text()).toContain(draft.fixed.inspectionLine);
    expect(named(view.host, draft.fixed.backToResults, "a").getAttribute("href")).toBe(resultsFor(WALK));
    await view.unmount();
  });
});

describe("Get It Fixed, adding an email", () => {
  it("saves a crew's email and shows it on the card, the form gone", async () => {
    const view = await planned();
    expect(view.host.querySelector(`[data-crew=${C1}] form`)).toBeNull();
    const form = find(view.host, `[data-crew=${C2}] form`);
    expect(form.querySelector("label")?.textContent).toBe(draft.fixed.emailLabel("Crew c2"));
    await typeInto(find<HTMLInputElement>(form, "input"), " owner@crews.example ");
    await tap(form, draft.fixed.addEmail);
    await until(() => view.host.querySelector(`[data-crew=${C2}] [data-part=email]`) !== null);
    expect(lines(view.host, `[data-crew=${C2}] [data-part=email]`)).toEqual(["Email: owner@crews.example"]);
    expect(view.host.querySelector(`[data-crew=${C2}] form`)).toBeNull();
    expect(callsTo(view.state, "PUT", `/api/jobs/${J1}/crews/${C2}/email`)[0]?.body).toEqual({ email: "owner@crews.example" });
    await view.unmount();
  });

  it("sends nothing for an empty email", async () => {
    const view = await planned();
    await tap(find(view.host, `[data-crew=${C2}] form`), draft.fixed.addEmail);
    expect(callsTo(view.state, "PUT", `/api/jobs/${J1}/crews/${C2}/email`)).toHaveLength(0);
    await view.unmount();
  });

  it("says the email cannot change once a request exists for that business", async () => {
    const view = await planned();
    view.state.view.jobs[0]!.messages = [message(M9, C2)];
    await typeInto(find<HTMLInputElement>(view.host, `[data-crew=${C2}] form input`), "late@crews.example");
    await tap(find(view.host, `[data-crew=${C2}] form`), draft.fixed.addEmail);
    await until(() => view.text().includes(draft.fixed.emailLocked));
    expect(view.host.querySelector(`[data-crew=${C2}] [data-part=email]`)).toBeNull();
    await view.unmount();
  });
});

describe("Get It Fixed, the requests", () => {
  it("writes a request per crew on Write My Requests and links each to its approval", async () => {
    const view = await planned();
    await tap(view.host, draft.fixed.writeRequests);
    await until(() => view.host.querySelector("li.message") !== null);
    expect(callsTo(view.state, "POST", `/api/jobs/${J1}/drafts`)).toHaveLength(1);
    expect(has(view.host, draft.fixed.writeRequests)).toBe(false);
    expect(lines(view.host, "li.message [data-part=state]")).toEqual(["Written and waiting for your okay.", "Written and waiting for your okay."]);
    expect(view.host.querySelector(`[data-crew=${C2}] form`)).toBeNull();
    const links = [...view.host.querySelectorAll<HTMLAnchorElement>("li.message a.button")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      [draft.fixed.review, approveFor(WALK, draftId(J1, 1))],
      [draft.fixed.review, approveFor(WALK, draftId(J1, 2))],
    ]);
    await view.unmount();
  });

  it("says the limit is reached, without promising a minute's wait, when drafting answers rate limited", async () => {
    const view = await planned(standIn({ view: jobsView([job(J1)]), limited: true }));
    await tap(view.host, draft.fixed.writeRequests);
    await until(() => view.text().includes("EmberWalk has done that as many times as it allows for now."));
    expect(view.text()).not.toContain("Wait a minute");
    expect(view.host.querySelector("li.message")).toBeNull();
    await view.unmount();
  });

  it("says the way a request stands: waiting, approved, sent, sent from the phone, replied", async () => {
    const jobs = job(J1, {
      messages: [
        message(M1, C1, { status: "draft" }),
        message(M2, C1, { status: "approved", outbox: { state: "failed", error: "x" } }),
        message(M3, C1, { status: "sent", sentAt: "2026-10-29T19:00:00.000Z" }),
        message(M4, C1, { status: "sent_by_phone", sentAt: "2026-10-30T19:00:00.000Z" }),
        message(M5, C1, { status: "replied" }),
      ],
    });
    const view = await planned(standIn({ view: jobsView([jobs]) }));
    expect(lines(view.host, "li.message [data-part=state]")).toEqual([
      "Written and waiting for your okay.",
      "Approved. The email did not go through yet.",
      "Sent on Oct. 29th, 2026.",
      "Sent from your phone on Oct. 30th, 2026.",
      "The crew replied.",
    ]);
    expect([...view.host.querySelectorAll("li.message")].map((li) => li.querySelector("a.button") !== null)).toEqual([true, true, false, false, false]);
    await view.unmount();
  });
});

describe("Get It Fixed, replies and reminders", () => {
  const READING = { price: "$1,200", date: "Saturday morning", questions: ["Is the gate open?"], declined: false, summary: "They can come Saturday for about $1,200." };

  it("shows a reply with what EmberWalk read from it", async () => {
    const replied = message(M1, C1, {
      status: "replied",
      replies: [{ id: R1, via: "email", receivedAt: "2026-10-29T19:00:00.000Z", text: "We can come Saturday.", reading: READING }],
    });
    const view = await planned(standIn({ view: jobsView([job(J1, { messages: [replied] })]) }));
    const reply = find(view.host, `[data-reply=${R1}]`);
    expect(lines(reply, ".who").slice(0, 1)).toEqual(["Reply by email, Oct. 29th, 2026"]);
    expect(lines(reply, ".said")).toEqual(["We can come Saturday."]);
    const read = find(reply, "[data-part=reading]").textContent ?? "";
    for (const line of [READING.summary, "Price they mentioned: $1,200", "Date they mentioned: Saturday morning", "Is the gate open?", draft.fixed.read]) expect(read).toContain(line);
    expect(read).not.toContain(draft.fixed.declined);
    await view.unmount();
  });

  it("says a crew said no, and shows a reply nothing could be read from as the words alone", async () => {
    const replied = message(M1, C1, {
      status: "replied",
      replies: [
        { id: R1, via: "email", receivedAt: "2026-10-29T19:00:00.000Z", text: "Sorry, booked solid.", reading: { ...READING, price: null, date: null, questions: [], declined: true, summary: "They are booked." } },
        { id: R2, via: "homeowner", receivedAt: "2026-10-29T20:00:00.000Z", text: "Called, no answer.", reading: null },
      ],
    });
    const view = await planned(standIn({ view: jobsView([job(J1, { messages: [replied] })]) }));
    expect(find(view.host, `[data-reply=${R1}]`).textContent).toContain(draft.fixed.declined);
    expect(find(view.host, `[data-reply=${R1}]`).textContent).not.toContain("Price they mentioned");
    expect(find(view.host, `[data-reply=${R2}]`).querySelector("[data-part=reading]")).toBeNull();
    expect(lines(find(view.host, `[data-reply=${R2}]`), ".who")).toEqual(["Reply you added, Oct. 29th, 2026"]);
    await view.unmount();
  });

  it("logs a reply that came by text or call, shows it, and sends nothing for an empty one", async () => {
    const sent = message(M1, C1, { status: "sent", sentAt: "2026-10-29T19:00:00.000Z" });
    const view = await planned(standIn({ view: jobsView([job(J1, { messages: [sent] })]) }));
    expect(has(view.host, draft.fixed.logReply)).toBe(true);
    await tap(view.host, draft.fixed.logReply);
    expect(view.text()).toContain(draft.fixed.replyEmpty);
    expect(callsTo(view.state, "POST", `/api/messages/${M1}/replies`)).toHaveLength(0);
    await typeInto(find<HTMLTextAreaElement>(view.host, "textarea"), "  They texted: Tuesday works.  ");
    await tap(view.host, draft.fixed.logReply);
    await until(() => view.host.querySelector("[data-reply]") !== null);
    expect(callsTo(view.state, "POST", `/api/messages/${M1}/replies`)[0]?.body).toEqual({ text: "They texted: Tuesday works." });
    expect(lines(view.host, ".said")).toEqual(["They texted: Tuesday works."]);
    expect(find<HTMLTextAreaElement>(view.host, "textarea").value).toBe("");
    await view.unmount();
  });

  it("offers no reply form on a request nobody has sent", async () => {
    const view = await planned(standIn({ view: jobsView([job(J1, { messages: [message(M1, C1)] })]) }));
    expect(view.host.querySelector("textarea")).toBeNull();
    await view.unmount();
  });

  it("lists reminders waiting for approval with a link to each draft, and skips done ones", async () => {
    const jobs = job(J1, {
      status: "waiting_on_crew",
      messages: [message(M1, C1, { status: "sent" })],
      followUps: [
        { id: F1, forMessageId: M1, dueAt: "2026-10-31T19:00:00.000Z", note: "Nudge Crew c1.", draftMessageId: M7, done: false },
        { id: F2, forMessageId: M1, dueAt: "2026-11-01T19:00:00.000Z", note: "", draftMessageId: null, done: false },
        { id: F3, forMessageId: M1, dueAt: "2026-10-30T19:00:00.000Z", note: "Old.", draftMessageId: M6, done: true },
      ],
    });
    const view = await planned(standIn({ view: jobsView([jobs]) }));
    expect(lines(view.host, `[data-followup=${F1}] p`)).toEqual(["A reminder is ready. It was due Oct. 31st, 2026.", "Nudge Crew c1."]);
    expect(named(find(view.host, `[data-followup=${F1}]`), draft.fixed.reviewReminder, "a").getAttribute("href")).toBe(approveFor(WALK, M7));
    expect(lines(view.host, `[data-followup=${F2}] p`)).toEqual(["Due Nov. 1st, 2026."]);
    expect(view.host.querySelector(`[data-followup=${F3}]`)).toBeNull();
    await tap(view.host, draft.fixed.writeReminders);
    await until(() => view.text().includes(draft.fixed.remindersChecked));
    expect(callsTo(view.state, "POST", `/api/walks/${WALK}/followups`)).toHaveLength(1);
    await view.unmount();
  });

  it("offers Write My Reminders once every request is approved and sent, with no status set by the test", async () => {
    const state = standIn({ view: jobsView([job(J1, { crews: [crew(C1), crew(C2)] })]) });
    const view = await planned(state);
    await tap(view.host, draft.fixed.writeRequests);
    await until(() => view.host.querySelector("li.message") !== null);
    expect(has(view.host, draft.fixed.writeReminders)).toBe(false);
    await view.unmount();
    for (const id of [draftId(J1, 1), draftId(J1, 2)]) {
      const approving = await mount(approveFor(WALK, id), state);
      await until(() => approving.host.querySelector("main.approve h2") !== null);
      await tap(approving.host, draft.approve.email);
      await until(() => callsTo(state, "POST", `/api/messages/${id}/approve`).length === 1);
      await approving.unmount();
    }
    const after = await planned(state);
    await until(() => has(after.host, draft.fixed.writeReminders));
    await after.unmount();
  });

  it("offers Write My Reminders only while a crew is being waited on", async () => {
    const view = await planned();
    expect(has(view.host, draft.fixed.writeReminders)).toBe(false);
    await view.unmount();
  });
});

describe("Get It Fixed, nothing goes out on its own", () => {
  it("asks for the jobs and nothing else until a button is tapped", async () => {
    const view = await planned();
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(view.state.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /api/walks/${WALK}/jobs`]);
    await view.unmount();
  });
});
