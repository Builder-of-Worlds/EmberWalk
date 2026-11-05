import { beforeEach, describe, expect, it } from "vitest";
import { finishEmail, finishEmailEs, welcomeMessage, welcomeMessageEs } from "../src/email-copy";
import { handle } from "../src/handler";
import { landingEs } from "../src/landing-es";
import { SHOWN_FROM_HELD, SPLITS, untranslatedLines } from "../src/landing-language";
import { createResendMailer } from "../src/resend";
import { unsubscribeUrl } from "../src/unsubscribe";
import approvedCopy from "./browser/approved-copy.json";
import { clearSignups, deps, fakeMailer, fakeVerify, signupRequest, TEST_SIGNING_VALUE, testEnv, validBody } from "./helpers";

const fetchPage = async (path: string, accept?: string, env = testEnv()) =>
  handle(new Request(`https://emberwalk.app${path}`, accept === undefined ? {} : { headers: { "accept-language": accept } }), env, deps(fakeVerify(), fakeMailer()));

const page = async (path: string, accept?: string, env = testEnv()) => {
  const response = await fetchPage(path, accept, env);
  expect(response.status).toBe(200);
  return response.text();
};

const HEADLINE = landingEs["When the next wildfire comes, will your home be ready?"]!;

describe("which language the landing page speaks", () => {
  it.each([
    ["es-MX,es;q=0.9,en;q=0.8", "/", "es"],
    ["es", "/", "es"],
    ["en-US,en;q=0.9,es;q=0.8", "/", "en"],
    ["en;q=0.5,es;q=0.9", "/", "es"],
    ["fr-FR", "/", "en"],
    [undefined, "/", "en"],
    ["es-MX", "/?lang=en", "en"],
    ["en-US", "/?lang=es", "es"],
    ["es-MX", "/?lang=fr", "es"],
    ["en-US", "/?lang=fr", "en"],
  ])("Accept-Language %s at %s is %s", async (accept, path, language) => {
    const html = await page(path, accept);
    expect(html).toContain(`<html lang="${language}">`);
    expect(html.includes(HEADLINE)).toBe(language === "es");
    expect(html.includes("<h1>When the next wildfire comes")).toBe(language === "en");
  });

  it("tells caches the page follows the phone's language", async () => {
    expect((await fetchPage("/", "es")).headers.get("vary")?.toLowerCase()).toContain("accept-language");
    expect((await fetchPage("/")).headers.get("vary")?.toLowerCase()).toContain("accept-language");
  });

  it("does not touch a file that is not a page", async () => {
    const script = await fetchPage("/site.js", "es");
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(script.headers.get("vary") ?? "").not.toContain("accept-language");
  });
});

describe("the visible choice", () => {
  const choices = (html: string) => [...html.matchAll(/<a href="\/\?lang=(en|es)" lang="\1"( aria-current="true")?>([^<]+)<\/a>/g)].map((m) => [m[1], m[2] !== undefined, m[3]]);

  it("offers English and Español at the top of the page and beside the form, and marks the one in use", async () => {
    const english = [["en", true, "English"], ["es", false, "Español"]];
    const spanish = [["en", false, "English"], ["es", true, "Español"]];
    expect(choices(await page("/"))).toEqual([...english, ...english]);
    expect(choices(await page("/?lang=es"))).toEqual([...spanish, ...spanish]);
  });

  it("names the choice in the page's language for a screen reader", async () => {
    expect(await page("/")).toContain('aria-label="Language"');
    const spanish = await page("/?lang=es");
    expect(spanish).toContain('aria-label="Idioma"');
    expect(spanish).not.toContain('aria-label="Language"');
  });
});

describe("the Spanish landing page", () => {
  it("leaves no line in English: text, alt text, labels, the title and the share lines", async () => {
    expect(untranslatedLines(await page("/"))).toEqual([]);
    expect(untranslatedLines(await page("/", undefined, testEnv({ LAUNCH_DATE_SHOWN: "on" } as object)))).toEqual([]);
  });

  it("reports a planted English line that has no Spanish, in text and in an attribute", () => {
    expect(untranslatedLines('<p>A brand new line.</p><img alt="A brand new picture"><meta name="description" content="A new summary">')).toEqual([
      "A brand new line.",
      "A brand new picture",
      "A new summary",
    ]);
  });

  it("leaves no English sentence on the served page", async () => {
    const html = await page("/?lang=es");
    for (const line of [...approvedCopy.blocks, ...approvedCopy.options, approvedCopy.button]) {
      if (/\p{L}/u.test(line) && !["EmberWalk"].includes(line)) expect(html, line).not.toContain(`>${line}<`);
    }
  });

  it("keeps the reviewed words exactly when a line is split around a tag", () => {
    for (const { en, es, enParts, esParts, join } of SPLITS) {
      expect(enParts.join(join)).toBe(en);
      expect(esParts.join(join)).toBe(es);
      expect(landingEs[en]).toBe(es);
    }
  });

  it("shows every piece of a split line on the page", async () => {
    const html = await page("/?lang=es", undefined, testEnv({ LAUNCH_DATE_SHOWN: "on" } as object));
    for (const { enParts, esParts } of SPLITS) {
      for (const [n, part] of esParts.entries()) if (/\p{L}/u.test(enParts[n]!) && part !== "Política de privacidad") expect(html, part).toContain(part.trim());
    }
  });

  it("shows a reviewed line whole wherever the page has it whole", async () => {
    const html = await page("/?lang=es");
    for (const line of ["The first five feet matter most", "Get Early Access", "Choose one", "Your list", "Walk"]) expect(html, line).toContain(`>${landingEs[line]}<`);
  });

  it("holds back the Spanish of every held line, as the English does", async () => {
    const html = await page("/?lang=es");
    expect(approvedCopy.held.length).toBeGreaterThan(0);
    for (const held of approvedCopy.held) expect(html, held).not.toContain(landingEs[held]);
    for (const clause of ["Nosotros organizamos", "cotizaciones", "cuadrillas con licencia", "les da seguimiento"]) expect(html).not.toContain(clause);
    expect([...html.matchAll(/<li class="ring-step"><span>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual([landingEs["Walk"], landingEs["Your list"], "Cuadrillas cerca de usted", "Solicitudes con sus fotos", "Seguimientos", "Trabajo hecho", "Solicitud de inspección"]);
    const middle = /<p class="ring-caption"[^>]*>(.*?)<\/p>/.exec(html)![1]!.replace(/<[^>]+>/g, "");
    expect(middle).toBe(`Paso 1 de 7: ${landingEs["Walk"]}`);
  });

  it("builds the shown line of a held paragraph only from its reviewed sentences", () => {
    const whole = landingEs[SHOWN_FROM_HELD.held]!;
    for (const sentence of SHOWN_FROM_HELD.es.split(/(?<=\.) /)) expect(whole).toContain(sentence);
    const english = SHOWN_FROM_HELD.held;
    for (const sentence of SHOWN_FROM_HELD.en.split(/(?<=\.) /)) expect(english).toContain(sentence);
  });

  it("follows the launch date flag in Spanish too", async () => {
    const off = await page("/?lang=es");
    expect(off).not.toContain("4 de noviembre");
    expect(off).not.toContain("data-launch-date");
    expect(await page("/?lang=es", undefined, testEnv({ LAUNCH_DATE_SHOWN: "on" } as object))).toContain("EmberWalk sale el 4 de noviembre de 2026.");
  });

  it("keeps links, the form's fields and the page's script untouched", async () => {
    const html = await page("/?lang=es");
    for (const piece of ['value="homeowner"', 'name="email"', 'href="mailto:hello@emberwalk.app"', 'src="/site.js"', 'placeholder="you@example.com"']) expect(html).toContain(piece);
  });

  it("shows the app's phone screens in the page's language", async () => {
    const phones = (html: string) => [...html.matchAll(/src="\/landing\/(synthetic-app-[a-z-]+\.webp)"/g)].map((m) => m[1]);
    expect(phones(await page("/"))).toEqual(["synthetic-app-record.webp", "synthetic-app-results.webp", "synthetic-app-finding.webp"]);
    expect(phones(await page("/?lang=es"))).toEqual(["synthetic-app-record-es.webp", "synthetic-app-results-es.webp", "synthetic-app-finding-es.webp"]);
    expect(phones(await page("/", "es-MX"))).toEqual(["synthetic-app-record-es.webp", "synthetic-app-results-es.webp", "synthetic-app-finding-es.webp"]);
  });
});

describe("the pages that have no Spanish say so", () => {
  const PAGES = ["pricing", "terms", "privacy", "refunds", "about", "contact", "security", "accessibility"];

  it.each(PAGES)("/%s stays marked English and says it is only in English, in Spanish", async (name) => {
    const env = testEnv({ POSTAL_ADDRESS: "1 Main St, Sacramento, CA" });
    const html = await page(`/${name}?lang=es`, undefined, env);
    expect(html).toContain('<html lang="en">');
    expect(html).toMatch(/<main[^>]*>\s*<p class="language-note" lang="es">Esta página está disponible solo en inglés\. <a href="\/\?lang=es">Volver a EmberWalk en español<\/a><\/p>/);
  });

  it("says so on the missing page too, keeping its 404 status", async () => {
    const response = await fetchPage("/no-such-page?lang=es");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<p class="language-note" lang="es">Esta página está disponible solo en inglés.');
  });

  it("adds nothing for someone reading in English", async () => {
    expect(await page("/privacy")).not.toContain("language-note");
    expect(await page("/privacy", "en-US")).not.toContain("language-note");
  });

  it("adds the same note for a Spanish phone that has made no choice", async () => {
    expect(await page("/privacy", "es-MX")).toContain("language-note");
  });

  it("marks every link to such a page on the Spanish landing page, and carries the language to it", async () => {
    const html = await page("/?lang=es");
    const footer = html.slice(html.indexOf('<footer class="site-footer">'));
    for (const name of PAGES) expect(footer, name).toMatch(new RegExp(`<a href="/${name}\\?lang=es">[^<]+ \\(en inglés\\)</a>`));
    expect(footer).toContain("EmberWalk es un producto de The Arbiter Bibendi LLC.");
    expect(html).toContain('<a href="/privacy?lang=es">Política de privacidad (en inglés)</a>');
  });

  it("leaves those links plain in English", async () => {
    const html = await page("/");
    expect(html).toContain('<a href="/privacy">Privacy Policy</a>');
    expect(html).not.toContain("?lang=es\">Pri");
  });
});

describe("the email a signup sends", () => {
  beforeEach(async () => {
    await clearSignups(testEnv().DB);
  });

  const signUp = async (body: object) => {
    const mailer = fakeMailer();
    const response = await handle(signupRequest({ ...validBody, ...body }), testEnv(), deps(fakeVerify("pass"), mailer));
    expect(response.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    return mailer.sent[0]!;
  };

  it("is all Spanish for someone who signed up on the Spanish page, with a Spanish way off the list", async () => {
    const sent = await signUp({ language: "es" });
    const link = await unsubscribeUrl("neighbor@example.com", TEST_SIGNING_VALUE);
    expect(sent).toEqual({ ...welcomeMessageEs("neighbor@example.com", `${link}&lang=es`, testEnv()), language: "es" });
  });

  it.each([[{}], [{ language: "en" }], [{ language: "fr" }], [{ language: 7 }]])("is English for %j, with an English way off the list", async (extra) => {
    const sent = await signUp(extra);
    const link = await unsubscribeUrl("neighbor@example.com", TEST_SIGNING_VALUE);
    expect(sent).toEqual(welcomeMessage("neighbor@example.com", `${link}&lang=en`, testEnv()));
  });

  it("keeps the English email's way off the list in English on a Spanish phone", async () => {
    const sent = await signUp({});
    const url = new URL(sent.unsubscribeUrl);
    const answer = await page(`${url.pathname}${url.search}`, "es-MX");
    expect(answer).toContain('<html lang="en">');
    expect(answer).toContain("You're unsubscribed");
  });

  const sentText = async (message: Parameters<ReturnType<typeof createResendMailer>["send"]>[0]) => {
    let body = {} as { text: string; subject: string };
    const fetchFake = (async (_: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response("{}");
    }) as unknown as typeof fetch;
    await createResendMailer("k", "1 Main St", fetchFake).send(message);
    return body;
  };

  it("never mixes languages as it goes out: subject, body and footer lines match", async () => {
    const link = "https://emberwalk.app/unsubscribe?t=x.y";
    const spanish = { ...welcomeMessageEs("a@example.com", `${link}&lang=es`, {}), language: "es" as const };
    const es = await sentText(spanish);
    expect(es.text).toBe(finishEmailEs(spanish, "1 Main St"));
    expect(es.subject).toBe("Ya está en la lista");
    expect(es.text).not.toMatch(/\b(the list|Thank you|Questions|We'll)\b/);
    const english = welcomeMessage("a@example.com", link, {});
    const en = await sentText(english);
    expect(en.text).toBe(finishEmail(english, "1 Main St"));
    expect(en.text).not.toMatch(/\b(Gracias|Preguntas|enlace)\b/);
  });
});

describe("the unsubscribe page", () => {
  it("answers in Spanish for the link in a Spanish email, whatever the outcome", async () => {
    const env = testEnv();
    const good = await unsubscribeUrl("gone@example.com", TEST_SIGNING_VALUE);
    const url = new URL(good);
    const removed = await page(`${url.pathname}${url.search}&lang=es`, undefined, env);
    expect(removed).toContain('<html lang="es">');
    expect(removed).toContain("Ya salió de la lista");
    expect(removed).not.toContain("You're unsubscribed");
    const invalid = await (await fetchPage("/unsubscribe?t=bad&lang=es", undefined, env)).text();
    expect(invalid).toContain('<html lang="es">');
    expect(invalid).toContain("hello@emberwalk.app");
    expect(invalid).not.toContain("That link");
  });

  it("says a failure in Spanish, with the 500 status", async () => {
    const response = await fetchPage("/unsubscribe?t=x.y&lang=es", undefined, { ...testEnv(), UNSUBSCRIBE_SECRET: "" });
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("Algo salió mal");
    expect(html).not.toContain("Something went wrong");
  });

  it("stays English for an English link", async () => {
    const invalid = await (await fetchPage("/unsubscribe?t=bad")).text();
    expect(invalid).toContain('<html lang="en">');
    expect(invalid).toContain("That link");
  });
});
