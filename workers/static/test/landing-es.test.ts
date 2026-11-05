import { describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { landingEs, ridgeAltEs } from "../src/landing-es";
import { deps, fakeMailer, fakeVerify, testEnv } from "./helpers";

const WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
};

const figures = (text: string): string[] =>
  [...text.toLowerCase().matchAll(/\d+|\p{L}+/gu)].map((m) => (/^\d/.test(m[0]) ? m[0] : WORDS[m[0]])).filter((n) => n !== undefined).sort();

const PAIRS: [string, string][] = [...Object.entries(landingEs), [ridgeAltEs.en, ridgeAltEs.es]];

const page = async (path: string) => {
  const response = await handle(new Request(`https://emberwalk.app${path}`), testEnv(), deps(fakeVerify(), fakeMailer()));
  expect(response.status).toBe(200);
  return response.text();
};

describe("the Spanish landing lines", () => {
  it("translates every line, keeping only names, the address and lines that are only a figure", () => {
    for (const [en, es] of PAIRS) {
      expect(es.trim(), en).not.toBe("");
      if (en.startsWith("Questions: ")) expect(es).toBe(`Preguntas: ${en.slice("Questions: ".length)}`);
      else if (!/\p{L}/u.test(en)) expect(es, en).toBe(en);
      else expect(es, en).not.toBe(en);
    }
  });

  it("keeps every date, number and distance of the English line", () => {
    for (const [en, es] of PAIRS) expect(figures(es), en).toEqual(figures(en));
  });

  it("catches a Spanish line that changes a figure written as a word", () => {
    const en = Object.keys(landingEs).find((line) => line.includes("split into three zones"))!;
    const planted = landingEs[en]!.replace("divididos en tres zonas", "divididos en dos zonas");
    expect(figures(planted)).not.toEqual(figures(en));
  });

  it("keeps the names IBHS, CAL FIRE and EmberWalk wherever the English has them", () => {
    for (const [en, es] of PAIRS) for (const name of ["IBHS", "CAL FIRE", "EmberWalk"]) expect(es.includes(name), `${name} in ${en}`).toBe(en.includes(name));
  });

  it("leaves no English phrase in a Spanish line", () => {
    for (const [en, es] of PAIRS) expect(es, en).not.toMatch(/\b(?:Board of Forestry|the|and|your)\b/);
  });
});

describe("the served pages stay English unless Spanish is asked for", () => {
  it.each(["/", "/privacy"])("%s carries none of the Spanish lines", async (path) => {
    const html = await page(path);
    expect(html).toContain('<html lang="en"');
    expect(html).not.toContain('<html lang="es"');
    for (const [en, es] of PAIRS) if (es !== en) expect(html).not.toContain(es);
  });
});
