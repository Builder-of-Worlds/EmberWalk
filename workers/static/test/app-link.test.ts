import { describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { untranslatedLines } from "../src/landing-language";
import { deps, fakeMailer, fakeVerify, testEnv } from "./helpers";

const page = async (path: string, flag?: string) => {
  const env = testEnv(flag === undefined ? {} : ({ APP_LINK_SHOWN: flag } as object));
  if (flag === undefined) delete (env as { APP_LINK_SHOWN?: string }).APP_LINK_SHOWN;
  const response = await handle(new Request(`https://emberwalk.app${path}`), env, deps(fakeVerify(), fakeMailer()));
  expect(response.status).toBe(200);
  return response.text();
};

const LINK = '<a class="button app-link" href="https://go.emberwalk.app">';

describe("the Open the App button", () => {
  it.each([[undefined], ["off"], ["On"], ["yes"], [""]])("is not on the page while the flag is %j, in either language", async (flag) => {
    for (const path of ["/", "/?lang=es"]) {
      const html = await page(path, flag);
      expect(html).not.toContain("go.emberwalk.app");
      expect(html).not.toContain("data-app-link");
      expect(html).not.toContain("Open the App");
      expect(html).not.toContain("Abrir la aplicación");
    }
  });

  it("is shipped on in the Worker's settings, with the film button beside it", async () => {
    const response = await handle(new Request("https://emberwalk.app/"), testEnv(), deps(fakeVerify(), fakeMailer()));
    const html = await response.text();
    expect(html).toContain(`${LINK}Open the App</a>`);
    expect(html).toContain('class="film-play"');
    expect(html).not.toContain("data-film-slot");
  });

  it("names the film on its button without promising a running time, in English and in Spanish", async () => {
    const labels: string[] = [];
    for (const path of ["/", "/?lang=es"]) {
      const response = await handle(new Request(`https://emberwalk.app${path}`), testEnv(), deps(fakeVerify(), fakeMailer()));
      const html = await response.text();
      const label = /class="film-play" aria-label="([^"]*)"/.exec(html)?.[1];
      expect(label, `${path} has a labelled film button`).toBeTruthy();
      expect(label).not.toMatch(/\d|minut|hour|hora|second|segundo/i);
      labels.push(label as string);
    }
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("keeps the film button off the page while its own flag is off", async () => {
    const response = await handle(new Request("https://emberwalk.app/"), testEnv({ FILM_SHOWN: "off" } as object), deps(fakeVerify(), fakeMailer()));
    const html = await response.text();
    expect(html).not.toContain("film-play");
    expect(html).toContain(`${LINK}Open the App</a>`);
  });

  it("opens the app, in English, once the flag is on", async () => {
    const html = await page("/", "on");
    expect(html).toContain(`${LINK}Open the App</a>`);
    expect(html).not.toContain("data-app-link");
  });

  it("opens the app, in Spanish, once the flag is on, with no English line left", async () => {
    const html = await page("/?lang=es", "on");
    expect(html).toContain(`${LINK}Abrir la aplicación</a>`);
    expect(untranslatedLines(await page("/", "on"))).toEqual([]);
  });
});
