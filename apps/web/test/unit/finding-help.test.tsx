import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { findingWords } from "../../src/draft-words.ts";
import { setLanguage } from "../../src/language.ts";
import { findingFor, fixFor } from "../../src/router.ts";
import { browserVoice, clipUrlFor, sentenceKey } from "../../src/voice.ts";
import type { Voice } from "../../src/voice.ts";
import { rememberTenantWalk } from "../../src/walk-claim.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { finding, walk } from "./result-fakes.ts";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const RESULTS = walk([finding("a", { instruction: "Move the wood pile." })]);

const open = async (voice?: Voice, results = RESULTS) => {
  window.location.hash = findingFor(results.id, "a");
  const view = await render(<App deps={testDeps({ results: async () => results, ...(voice === undefined ? {} : { voice }) })} />);
  await until(() => view.host.querySelector("main.one-finding") !== null);
  return view;
};

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLElement>("a, button")].find((b) => b.textContent === text);

afterEach(() => {
  window.location.hash = "";
});

describe("Help Near You on a finding", () => {
  it("opens Get It Fixed for this walk", async () => {
    const view = await open();
    expect(button(view.host, findingWords.help)?.getAttribute("href")).toBe(fixFor(RESULTS.id));
    await view.unmount();
  });

  it("is not offered on a tenant's walk, which cannot open Get It Fixed, and Hear It stays", async () => {
    rememberTenantWalk(RESULTS.id);
    const view = await open();
    expect(button(view.host, findingWords.help)).toBeUndefined();
    expect(button(view.host, findingWords.hear)).toBeDefined();
    await view.unmount();
    window.localStorage.removeItem("emberwalk.tenantWalks");
  });
});

describe("Hear It on a finding", () => {
  const recording = (answer: "clip" | "phone" | "none") => {
    const said: string[] = [];
    let stopped = 0;
    const voice: Voice = { say: async (text) => (said.push(text), answer), stop: () => void stopped++ };
    return { said, voice, stops: () => stopped };
  };

  it("reads that finding's own sentence aloud on the tap, and stops on leaving", async () => {
    const { said, voice, stops } = recording("clip");
    const view = await open(voice);
    expect(said).toEqual([]);
    await settle(() => button(view.host, findingWords.hear)!.click());
    expect(said).toEqual(["Move the wood pile."]);
    await view.unmount();
    expect(stops()).toBeGreaterThan(0);
  });

  it("reads the sentence in the language the screen shows", async () => {
    const { said, voice } = recording("phone");
    const results = walk([finding("a", { instruction: "Move the wood pile.", instructions: { en: "Move the wood pile.", es: "Mueva la leña." } })]);
    window.location.hash = findingFor(results.id, "a");
    const deps = testDeps({ results: async () => results, voice });
    const view = await render(<App deps={{ ...deps, prefs: { ...deps.prefs, language: () => "es" } }} />);
    await until(() => view.host.querySelector("main.one-finding") !== null);
    await settle(() => button(view.host, findingWords.hear)!.click());
    expect(said).toEqual(["Mueva la leña."]);
    await view.unmount();
    setLanguage("en");
  });

  it("says so when the phone cannot speak", async () => {
    const view = await open(recording("none").voice);
    await settle(() => button(view.host, findingWords.hear)!.click());
    await until(() => view.text().includes(findingWords.cannotHear));
    expect(view.text()).toContain(findingWords.cannotHear);
    await view.unmount();
  });
});

describe("the voice", () => {
  const CLIPS = { [sentenceKey("Move the wood pile.")]: "voice/a.mp3" };

  const fakes = (over: { audioFails?: boolean; noSpeech?: boolean } = {}) => {
    const played: string[] = [];
    const spoken: { text: string; lang: string }[] = [];
    const paused: string[] = [];
    const env = {
      newAudio: (src: string) => ({
        play: async () => {
          if (over.audioFails) throw new Error("no audio");
          played.push(src);
        },
        pause: () => void paused.push(src),
      }),
      speech:
        over.noSpeech === true
          ? null
          : {
              speak: (text: string, lang: string) => void spoken.push({ text, lang }),
              cancel: () => void paused.push("speech"),
            },
      language: () => "es",
    };
    return { env, played, spoken, paused };
  };

  it("finds a clip only for that exact sentence", () => {
    expect(clipUrlFor("Move the wood pile.", CLIPS)).toBe("voice/a.mp3");
    expect(clipUrlFor("Move the wood pile", CLIPS)).toBeNull();
  });

  it("plays the recorded clip of the exact sentence, and never the phone voice beside it", async () => {
    const { env, played, spoken } = fakes();
    expect(await browserVoice(env, CLIPS).say("Move the wood pile.")).toBe("clip");
    expect(played).toEqual(["voice/a.mp3"]);
    expect(spoken).toEqual([]);
  });

  it("falls back to the phone voice with no clip, in the page's language", async () => {
    const { env, played, spoken } = fakes();
    expect(await browserVoice(env, CLIPS).say("Another sentence.")).toBe("phone");
    expect(played).toEqual([]);
    expect(spoken).toEqual([{ text: "Another sentence.", lang: "es" }]);
  });

  it("falls back to the phone voice when the clip will not play, and reports none when nothing can speak", async () => {
    const failing = fakes({ audioFails: true });
    expect(await browserVoice(failing.env, CLIPS).say("Move the wood pile.")).toBe("phone");
    const silent = fakes({ audioFails: true, noSpeech: true });
    expect(await browserVoice(silent.env, CLIPS).say("Move the wood pile.")).toBe("none");
  });

  it("stops what is playing before speaking again, and on stop", async () => {
    const { env, paused } = fakes();
    const voice = browserVoice(env, CLIPS);
    await voice.say("Move the wood pile.");
    await voice.say("Move the wood pile.");
    expect(paused).toContain("voice/a.mp3");
    voice.stop();
    expect(paused).toContain("speech");
  });
});
