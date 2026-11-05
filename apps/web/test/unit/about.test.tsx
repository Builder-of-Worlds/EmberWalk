import { DEFAULT_LIMITS, DELETE_EVERYTHING_PATH, limitsWith, VISITOR_HEADER } from "@emberwalk/shared";
import type { DeleteEverythingResponse } from "@emberwalk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Answer } from "../../src/api.ts";
import { App } from "../../src/App.tsx";
import type { Deps } from "../../src/deps.ts";
import { accountLeftBehind, closePortfolio, deleteEverythingWords as words, openPortfolio } from "../../src/draft-words.ts";
import { eraseApi } from "../../src/erase-api.ts";
import type { Source } from "../../src/results.ts";
import { ROUTES } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { finding, walk } from "./result-fakes.ts";

const VISITOR = "a".repeat(64);
const FLAG_ON = '{"deleteEverythingOn":true}';
const ON = limitsWith({ deleteEverythingOn: true });

const go = (hash: string) =>
  settle(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

const buttons = (host: HTMLElement) => [...host.querySelectorAll("main button")].map((b) => b.textContent);

const tap = (host: HTMLElement, label: string) =>
  settle(() => {
    const found = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
    if (found === undefined) throw new Error(`no button "${label}" in: ${host.textContent}`);
    found.click();
  });

const status = (host: HTMLElement) => host.querySelector("[role=status]")?.textContent ?? null;

const entry = (host: HTMLElement) => [...host.querySelectorAll("a")].find((a) => a.textContent === words.entry) ?? null;

const source = (retrievedOn?: string) =>
  ({ citation: "Rule", words: "words", status: "in_force", url: "https://example.org/rule", ...(retrievedOn === undefined ? {} : { retrievedOn }) }) as Source;

const sampleReadOn = (...days: (string | undefined)[]): Deps["results"] => {
  const sample = walk(days.map((day, n) => finding(`f-${n}`, { sources: [source(day)] })), [], { id: SAMPLES[0]!.id, synthetic: true });
  return async (id) => (id === sample.id ? sample : null);
};

const rulesLine = (host: HTMLElement) => host.querySelector(".rules-read")?.textContent ?? null;

const answering = (...answers: Answer<DeleteEverythingResponse>[]) => {
  const calls: number[] = [];
  const pending: ((answer: Answer<DeleteEverythingResponse>) => void)[] = [];
  const everything = () => {
    calls.push(calls.length);
    const next = answers[calls.length - 1];
    return next === undefined ? new Promise<Answer<DeleteEverythingResponse>>((resolve) => pending.push(resolve)) : Promise.resolve(next);
  };
  return { erase: { everything }, calls, pending };
};

const counting = (fail = false) => {
  const forgot: number[] = [];
  const forgetSent = async () => {
    forgot.push(forgot.length);
    if (fail) throw new Error("storage refused");
  };
  return { forgetSent, forgot };
};

const openAbout = async (erase = answering({ value: { walks: 2, left: 0 } }), over: Partial<Deps> = {}) => {
  const forget = counting();
  const view = await render(<App deps={testDeps({ erase: erase.erase, limits: ON, forgetSent: forget.forgetSent, ...over })} />);
  await go(ROUTES.about);
  return { view, ...erase, forgot: forget.forgot };
};

const confirmErase = async (host: HTMLElement) => {
  await tap(host, words.start);
  await tap(host, words.yes);
};

afterEach(() => {
  vi.unstubAllEnvs();
  window.location.hash = "";
});

describe("the Delete Everything flag", () => {
  it("comes from the app's limits, so the build's own setting alone never shows Delete Everything", async () => {
    vi.stubEnv("VITE_EMBERWALK_LIMITS", FLAG_ON);
    const { view, calls } = await openAbout(answering(), { limits: { ...DEFAULT_LIMITS, deleteEverythingOn: false } });
    expect(view.text()).not.toContain(words.heading);
    expect(buttons(view.host)).toEqual([]);
    expect(calls).toEqual([]);
    await view.unmount();
  });

  it("shows About with the not an inspection and rules lines, and no Delete Everything, while the flag is off", async () => {
    const { view, calls } = await openAbout(answering(), { limits: limitsWith({ deleteEverythingOn: false }), results: sampleReadOn("2026-10-25") });
    expect(view.host.querySelector("h1")?.textContent).toBe(words.title);
    expect(view.text()).toContain(words.notInspection);
    expect(rulesLine(view.host)).toBe(words.rulesRead("Oct. 25th, 2026", "Oct. 25th, 2026"));
    expect(view.text()).not.toContain(words.heading);
    expect(view.text()).not.toContain(words.kept);
    expect(buttons(view.host)).toEqual([]);
    await go(ROUTES.settings);
    expect(entry(view.host)?.getAttribute("href")).toBe(ROUTES.about);
    expect(calls).toEqual([]);
    await view.unmount();
  });

  it("shows both lines and Delete Everything while the flag is on", async () => {
    const { view } = await openAbout(undefined, { results: sampleReadOn("2026-10-25") });
    expect(view.text()).toContain(words.notInspection);
    expect(rulesLine(view.host)).toBe(words.rulesRead("Oct. 25th, 2026", "Oct. 25th, 2026"));
    expect(view.text()).toContain(words.heading);
    expect(buttons(view.host)).toEqual([words.start]);
    await view.unmount();
  });

  it("shows the About and Privacy entry in Settings, and not twice on a first open Home, and it opens the screen", async () => {
    const view = await render(<App deps={testDeps({ limits: ON })} />);
    await go(ROUTES.home);
    expect(entry(view.host)).toBeNull();
    await go(ROUTES.settings);
    expect(entry(view.host)?.getAttribute("href")).toBe(ROUTES.about);
    await go(ROUTES.about);
    expect(view.host.querySelector("h1")?.textContent).toBe(words.title);
    expect(view.text()).toContain(words.lead);
    await view.unmount();
  });
});

describe("what the About and Privacy screen says is kept", () => {
  it("says, before anything is erased, what is kept: plan and payment records, the lists, and an unlinked record of each check's cost", async () => {
    const { view } = await openAbout();
    expect(words.kept).toBe(
      "After Delete Everything, we keep your plan and payment records, the sign up list, the list of crews who asked not to be emailed, and a record of what each check cost, with no link to you or your walk.",
    );
    expect(view.text()).toContain(words.kept);
    await view.unmount();
  });
});

describe("what the About and Privacy screen says about the check", () => {
  it("says the check is not an inspection", async () => {
    const { view } = await openAbout(undefined, { results: sampleReadOn("2026-10-25") });
    expect(view.text()).toContain(words.notInspection);
    await view.unmount();
  });

  it("names the day the rules were retrieved, read from the sample walk's finding sources", async () => {
    const { view } = await openAbout(undefined, { results: sampleReadOn("2026-11-02", "2026-11-02") });
    expect(rulesLine(view.host)).toBe(words.rulesRead("Nov. 2nd, 2026", "Nov. 2nd, 2026"));
    await view.unmount();
  });

  it("names the first and last day when the sources were retrieved on different days", async () => {
    const { view } = await openAbout(undefined, { results: sampleReadOn("2026-10-29", "2026-10-24", "2026-10-25") });
    expect(rulesLine(view.host)).toBe(words.rulesRead("Oct. 24th, 2026", "Oct. 29th, 2026"));
    await view.unmount();
  });

  it("names only the days the sources hold, passing over a source with no retrievedOn", async () => {
    const { view } = await openAbout(undefined, { results: sampleReadOn(undefined, "2026-10-26", "") });
    expect(rulesLine(view.host)).toBe(words.rulesRead("Oct. 26th, 2026", "Oct. 26th, 2026"));
    await view.unmount();
  });

  it("names no day when no source holds a retrievedOn or the sample cannot be read, and still says it is not an inspection", async () => {
    for (const results of [sampleReadOn(undefined, undefined), async () => null, async () => Promise.reject(new Error("unreadable"))] as Deps["results"][]) {
      const { view } = await openAbout(undefined, { results });
      expect(rulesLine(view.host)).toBeNull();
      expect(view.text()).toContain(words.notInspection);
      await view.unmount();
    }
  });

});

describe("the About and Privacy screen", () => {
  it("asks to confirm before it erases anything, and Go Back erases nothing", async () => {
    const { view, calls } = await openAbout();
    expect(buttons(view.host)).toEqual([words.start]);
    await tap(view.host, words.start);
    expect(view.text()).toContain(words.confirm);
    expect(buttons(view.host)).toEqual([words.yes, words.no]);
    expect(calls).toEqual([]);
    await tap(view.host, words.no);
    expect(buttons(view.host)).toEqual([words.start]);
    expect(view.text()).not.toContain(words.confirm);
    expect(calls).toEqual([]);
    await view.unmount();
  });

  it("erases once on Yes, says so while it works, then says it is done", async () => {
    const erase = answering();
    const { view, calls, pending } = await openAbout(erase);
    await tap(view.host, words.start);
    await tap(view.host, words.yes);
    expect(calls).toHaveLength(1);
    expect(status(view.host)).toBe(words.working);
    expect(buttons(view.host)).toEqual([]);
    await settle(() => pending[0]!({ value: { walks: 3, left: 0 } }));
    expect(status(view.host)).toBe(words.done);
    expect(buttons(view.host)).toEqual([]);
    expect(view.host.querySelector(`a[href="${ROUTES.home}"]`)?.textContent).toBe(words.back);
    await view.unmount();
  });

  it("asks again while the server says walks are left, and is done only when none are", async () => {
    const { view, calls, forgot } = await openAbout(answering({ value: { walks: 18, left: 30 } }, { value: { walks: 18, left: 12 } }, { value: { walks: 12, left: 0 } }));
    await confirmErase(view.host);
    expect(calls).toHaveLength(3);
    expect(status(view.host)).toBe(words.done);
    expect(forgot).toHaveLength(1);
    await view.unmount();
  });

  it("asks again when a walk started during the erase is left, and replaces the key only after that walk is erased too", async () => {
    const erase = answering({ value: { walks: 3, left: 1 } }, { value: { walks: 1, left: 0 } });
    const callsWhenForgot: number[] = [];
    const { view, calls } = await openAbout(erase, { forgetSent: async () => void callsWhenForgot.push(erase.calls.length) });
    await confirmErase(view.host);
    expect(calls).toHaveLength(2);
    expect(callsWhenForgot).toEqual([2]);
    expect(status(view.host)).toBe(words.done);
    await view.unmount();
  });

  it("stops and offers to try again when the walks left do not go down, clearing nothing on the phone", async () => {
    const { view, calls, forgot } = await openAbout(answering({ value: { walks: 5, left: 4 } }, { value: { walks: 0, left: 4 } }, { value: { walks: 4, left: 0 } }));
    await confirmErase(view.host);
    expect(calls).toHaveLength(2);
    expect(status(view.host)).toBe(words.failed);
    expect(buttons(view.host)).toEqual([words.start]);
    expect(forgot).toEqual([]);
    await view.unmount();
  });

  it("clears this phone's copies of sent walks once, and only after the server has erased them all", async () => {
    const { view, forgot } = await openAbout(answering({ value: { walks: 2, left: 0 } }));
    expect(forgot).toEqual([]);
    await confirmErase(view.host);
    expect(forgot).toHaveLength(1);
    await view.unmount();
  });

  it("says it could not finish when the phone cannot clear its copies, and a second try clears them", async () => {
    const failing = counting(true);
    const { view, calls } = await openAbout(answering({ value: { walks: 2, left: 0 } }, { value: { walks: 0, left: 0 } }), { forgetSent: failing.forgetSent });
    await confirmErase(view.host);
    expect(status(view.host)).toBe(words.failed);
    expect(buttons(view.host)).toEqual([words.start]);
    await confirmErase(view.host);
    expect(calls).toHaveLength(2);
    expect(failing.forgot).toHaveLength(2);
    await view.unmount();
  });

  it("says to sign in first when the server refuses a signed out account, and clears nothing", async () => {
    const refusing = answering();
    const { view, forgot } = await openAbout(refusing, { erase: { everything: async () => ({ code: "sign_in_first" as const }) } });
    await confirmErase(view.host);
    expect(status(view.host)).toBe(words.signInFirst);
    expect(forgot).toEqual([]);
    await view.unmount();
  });

  it("after Sign Out on this phone, erases what the phone holds and says plainly the account's data stays, with the way to it", async () => {
    closePortfolio();
    const { view, calls, forgot } = await openAbout(answering({ value: { walks: 0, left: 0 } }));
    await confirmErase(view.host);
    expect(status(view.host)).toBe(words.doneAccountKept);
    expect(status(view.host)).not.toBe(words.done);
    expect(calls).toHaveLength(1);
    expect(forgot).toHaveLength(1);
    expect(view.host.querySelector(`a[href="${ROUTES.signIn}"]`)).not.toBeNull();
    openPortfolio();
    await view.unmount();
  });

  it("when the server says the account stayed, tells the phone so, and remembers it after the phone's id is renewed", async () => {
    openPortfolio();
    const { view, forgot } = await openAbout(answering({ value: { walks: 1, left: 0, accountKept: true } as DeleteEverythingResponse }));
    await confirmErase(view.host);
    expect(status(view.host)).toBe(words.doneAccountKept);
    expect(forgot).toHaveLength(1);
    expect(accountLeftBehind()).toBe(true);
    openPortfolio();
    await view.unmount();
  });

  it("says nothing of an account on a phone with none", async () => {
    openPortfolio();
    const { view } = await openAbout(answering({ value: { walks: 1, left: 0 } }));
    await confirmErase(view.host);
    expect(status(view.host)).toBe(words.done);
    await view.unmount();
  });

  it("reads the server's account line through the real client", async () => {
    const send = async () => Response.json({ walks: 1, left: 0, accountKept: true });
    const answer = await eraseApi("http://localhost", send, () => "a".repeat(64)).everything();
    expect(answer).toEqual({ value: { walks: 1, left: 0, accountKept: true } });
  });

  it("says a walk is still being sent or checked when the server refuses with conflict, and clears nothing", async () => {
    const { view, forgot } = await openAbout(answering({ code: "conflict" }, { value: { walks: 1, left: 0 } }));
    await confirmErase(view.host);
    expect(status(view.host)).toBe(words.busy);
    expect(buttons(view.host)).toEqual([words.start]);
    expect(forgot).toEqual([]);
    await confirmErase(view.host);
    expect(status(view.host)).toBe(words.done);
    await view.unmount();
  });

  it("says there is no signal when offline, and a second try can finish", async () => {
    const { view, calls, forgot } = await openAbout(answering({ code: "offline" }, { value: { walks: 0, left: 0 } }));
    await tap(view.host, words.start);
    await tap(view.host, words.yes);
    expect(status(view.host)).toBe(words.offline);
    expect(buttons(view.host)).toEqual([words.start]);
    expect(forgot).toEqual([]);
    await tap(view.host, words.start);
    await tap(view.host, words.yes);
    expect(calls).toHaveLength(2);
    expect(status(view.host)).toBe(words.done);
    await view.unmount();
  });

  it("says it could not finish when the server refuses or fails, and offers to try again", async () => {
    const { view, forgot } = await openAbout(answering({ code: "server_error" }));
    await tap(view.host, words.start);
    await tap(view.host, words.yes);
    expect(status(view.host)).toBe(words.failed);
    expect(buttons(view.host)).toEqual([words.start]);
    expect(forgot).toEqual([]);
    await view.unmount();
  });
});

describe("the erase call", () => {
  it("posts this phone's visitor in the header and the body", async () => {
    const sent: Request[] = [];
    const api = eraseApi("https://emberwalk.test", async (request) => {
      sent.push(request);
      return Response.json({ walks: 4, left: 1 });
    }, () => VISITOR);
    expect(await api.everything()).toEqual({ value: { walks: 4, left: 1 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
    expect(new URL(sent[0]!.url).pathname).toBe(DELETE_EVERYTHING_PATH);
    expect(sent[0]!.headers.get(VISITOR_HEADER)).toBe(VISITOR);
    expect(await sent[0]!.json()).toEqual({ visitorId: VISITOR });
  });

  it("reads a 401 as sign in first", async () => {
    const api = eraseApi("https://emberwalk.test", async () => Response.json({ error: { code: "sign_in_first", message: "x" } }, { status: 401 }), () => VISITOR);
    expect(await api.everything()).toEqual({ code: "sign_in_first" });
  });

  it("reads a refusal as its code and a wrong answer as a server error", async () => {
    const refused = eraseApi("https://emberwalk.test", async () => Response.json({ error: { code: "not_found", message: "x" } }, { status: 404 }), () => VISITOR);
    expect(await refused.everything()).toEqual({ code: "not_found" });
    const wrong = eraseApi("https://emberwalk.test", async () => Response.json({ walks: -1 }), () => VISITOR);
    expect(await wrong.everything()).toEqual({ code: "server_error" });
  });
});
