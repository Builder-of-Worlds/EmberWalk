import { afterEach, describe, expect, it } from "vitest";
import { crewWords } from "../../src/draft-words.ts";
import { fixFor, ROUTES } from "../../src/router.ts";
import { J1, job, jobsView, standIn, WALK } from "./fixed-fakes.ts";
import { callsTo, find, mount, tap, typeInto, until } from "./fixed-screen.tsx";

const fill = async (host: HTMLElement, over: Partial<Record<"name" | "license" | "email" | "phone" | "zip", string>> = {}) => {
  const values = { name: "Ridge Brush", license: "2000001", email: "office@ridge.test", phone: "209 555 0177", zip: "95370", ...over };
  await typeInto(find<HTMLInputElement>(host, "#crew-name"), values.name);
  await typeInto(find<HTMLInputElement>(host, "#crew-license"), values.license);
  await typeInto(find<HTMLInputElement>(host, "#crew-email"), values.email);
  await typeInto(find<HTMLInputElement>(host, "#crew-phone"), values.phone);
  await typeInto(find<HTMLInputElement>(host, "#crew-zip"), values.zip);
};

const agree = (host: HTMLElement) => find<HTMLInputElement>(host, "#crew-agree").click();

afterEach(() => {
  window.location.hash = "";
});

describe("the crew signup page", () => {
  it("sends the whole form once the crew agrees, and says to check email", async () => {
    const state = standIn();
    const view = await mount(ROUTES.crews, state);
    await until(() => view.host.querySelector("main.crew-signup") !== null);
    await fill(view.host);
    agree(view.host);
    await tap(view.host, crewWords.submit);
    const [call] = callsTo(state, "POST", "/api/crew-signups");
    expect(call?.body).toEqual({ businessName: "Ridge Brush", licenseNumber: "2000001", licenseClass: "C-27", email: "office@ridge.test", phone: "+12095550177", zip: "95370", agreed: true });
    expect(view.text()).toContain(crewWords.checkEmail);
    await view.unmount();
  });

  it("sends nothing until the agreement is ticked", async () => {
    const state = standIn();
    const view = await mount(ROUTES.crews, state);
    await until(() => view.host.querySelector("main.crew-signup") !== null);
    await fill(view.host);
    await tap(view.host, crewWords.submit);
    expect(callsTo(state, "POST", "/api/crew-signups")).toEqual([]);
    expect(view.text()).toContain(crewWords.mustAgree);
    await view.unmount();
  });

  it("asks again for a phone number it cannot read, and takes a crew with no phone", async () => {
    const state = standIn();
    const view = await mount(ROUTES.crews, state);
    await until(() => view.host.querySelector("main.crew-signup") !== null);
    await fill(view.host, { phone: "555" });
    agree(view.host);
    await tap(view.host, crewWords.submit);
    expect(callsTo(state, "POST", "/api/crew-signups")).toEqual([]);
    expect(view.text()).toContain(crewWords.badPhone);
    await typeInto(find<HTMLInputElement>(view.host, "#crew-phone"), "");
    await tap(view.host, crewWords.submit);
    expect(callsTo(state, "POST", "/api/crew-signups")[0]?.body).toMatchObject({ phone: null });
    await view.unmount();
  });

  it("says plainly when the state list does not show the license, in a fixed sentence", async () => {
    const state = standIn();
    state.signupRefused = true;
    const view = await mount(ROUTES.crews, state);
    await until(() => view.host.querySelector("main.crew-signup") !== null);
    await fill(view.host);
    agree(view.host);
    await tap(view.host, crewWords.submit);
    expect(view.text()).toContain(crewWords.notListed);
    expect(view.text()).not.toContain(crewWords.checkEmail);
    await view.unmount();
  });

  it.each([
    ["license_listed", crewWords.licenseListed],
    ["license_waiting", crewWords.licenseWaiting],
  ] as const)("says what %s means, and never to check email", async (status, words) => {
    const state = standIn();
    state.signupAnswer = status;
    const view = await mount(ROUTES.crews, state);
    await until(() => view.host.querySelector("main.crew-signup") !== null);
    await fill(view.host);
    agree(view.host);
    await tap(view.host, crewWords.submit);
    expect(view.text()).toContain(words);
    expect(view.text()).not.toContain(crewWords.checkEmail);
    expect(view.text()).not.toContain(crewWords.notListed);
    await view.unmount();
  });

  it("is reached from the About screen", async () => {
    const about = await mount(ROUTES.about, standIn());
    await until(() => about.host.querySelector("[data-part=list-your-crew]") !== null);
    expect(about.host.querySelector("[data-part=list-your-crew]")?.getAttribute("href")).toBe(ROUTES.crews);
    await about.unmount();
  });
});

describe("naming your own crew", () => {
  const viewFor = async () => {
    const state = standIn({ view: jobsView([job(J1)]) });
    const view = await mount(fixFor(WALK), state);
    await until(() => view.host.querySelector("main.fix [data-job]") !== null);
    return { state, view };
  };

  it("adds a crew by name and email before the requests are written", async () => {
    const { state, view } = await viewFor();
    await typeInto(find<HTMLInputElement>(view.host, "[data-part=name-crew] input[name=name]"), "My Crew");
    await typeInto(find<HTMLInputElement>(view.host, "[data-part=name-crew] input[name=contact]"), "crew@me.test");
    await tap(view.host, crewWords.addCrew);
    const added = state.calls.filter((c) => c.method === "POST" && c.path.endsWith("/crews"));
    expect(added[0]?.body).toEqual({ name: "My Crew", email: "crew@me.test", phone: null });
    await view.unmount();
  });

  it("reads a phone number as a phone, and asks again for something that is neither", async () => {
    const { state, view } = await viewFor();
    await typeInto(find<HTMLInputElement>(view.host, "[data-part=name-crew] input[name=name]"), "My Crew");
    await typeInto(find<HTMLInputElement>(view.host, "[data-part=name-crew] input[name=contact]"), "nope");
    await tap(view.host, crewWords.addCrew);
    expect(view.text()).toContain(crewWords.needContact);
    expect(state.calls.filter((c) => c.path.endsWith("/crews"))).toEqual([]);
    await typeInto(find<HTMLInputElement>(view.host, "[data-part=name-crew] input[name=contact]"), "(209) 555-0177");
    await tap(view.host, crewWords.addCrew);
    expect(state.calls.filter((c) => c.path.endsWith("/crews"))[0]?.body).toEqual({ name: "My Crew", email: null, phone: "+12095550177" });
    await view.unmount();
  });
});
