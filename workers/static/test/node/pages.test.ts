import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExtraWalksRequest, MAX_EXTRA_WALKS, OFFER_CONFIG } from "../../../../packages/shared/src/billing.ts";
import { ENTITY } from "../../../../packages/shared/src/entity.ts";

type Offers = typeof OFFER_CONFIG;

interface Sources {
  site: Record<string, string>;
  entity: Record<string, string>;
  offers: Offers;
  pages: Record<string, string>;
  indexHtml: string;
}

interface PagesScript {
  ORIGIN: string;
  readSources(): Sources;
  renderAll(sources: Sources): Map<string, string>;
  parsePage(name: string, text: string, known: Set<string>, entity?: Record<string, string>): { title: string; description: string; updated: string; blocks: string[] };
  deployProblems(sources: Sources): string[];
}

const STATIC = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = `${STATIC}scripts/pages.mjs`;
const P = (await import(SCRIPT)) as PagesScript;
const KNOWN = new Set(["/", "/privacy", "/404"]);
const PUBLIC_SET = ["pricing", "terms", "privacy", "refunds", "about", "contact", "security", "accessibility"];
const FOOTER_SET = ["pricing", "terms", "privacy", "refunds"];

function footerOf(html: string) {
  return /<footer class="site-footer">([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? "";
}

function footerPaths(html: string) {
  return [...footerOf(html).matchAll(/<a href="(\/[^"]*)"/g)].map((m) => m[1]);
}

function bodyText(html: string) {
  const main = /<main>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
  return main.replace(/<p class="rise updated">[\s\S]*?<\/p>/, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function page(lines: string[]) {
  return lines.join("\n");
}

function committedCopy() {
  const dir = mkdtempSync(path.join(tmpdir(), "ew-pages-"));
  for (const file of P.renderAll(P.readSources()).keys()) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(`${STATIC}public/${file}`, path.join(dir, file));
  }
  return dir;
}

function checkExit(dir: string) {
  try {
    execFileSync(process.execPath, [SCRIPT, "--check", "--dir", dir], { stdio: "pipe" });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

const GOOD = page(["# A title", "Description: A description.", "Last updated: 2026-10-30", "", "## A section", "", "A paragraph with [home](/) and **bold**.", "", "- one", "- two", ""]);

describe("renderer", () => {
  it("writes every generated file byte for byte as the renderer makes it", () => {
    const out = P.renderAll(P.readSources());
    expect(out.size).toBeGreaterThan(0);
    for (const [file, content] of out) {
      expect(existsSync(`${STATIC}public/${file}`), file).toBe(true);
      expect(readFileSync(`${STATIC}public/${file}`, "utf8"), file).toBe(content);
    }
  });

  it("renders headings, paragraphs, lists, links and bold", () => {
    const out = P.renderAll({ ...P.readSources(), pages: { ...P.readSources().pages, sample: GOOD } });
    const html = out.get("sample.html") ?? "";
    expect(html).toContain('<h1 class="rise">A title</h1>');
    expect(html).toContain('<h2 class="rise">A section</h2>');
    expect(html).toContain('<a href="/">home</a>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("Last updated: Oct. 30th, 2026.");
  });

  it.each([
    ["raw HTML", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "<b>x</b>"]), /raw HTML/],
    ["a code fence", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "```", "x", "```"]), /code fence/],
    ["a second title", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "# Again"]), /second title/],
    ["no title", page(["Description: D.", "Last updated: 2026-10-30", "", "x"]), /title/],
    ["no date", page(["# T", "Description: D.", "", "x"]), /Last updated/],
    ["a doubled date", page(["# T", "Description: D.", "Last updated: 2026-10-30", "Last updated: 2026-10-31", "", "x"]), /Last updated/],
    ["a second date in the body", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "Last updated: 2026-11-01"]), /Last updated/],
    ["a second date inside a paragraph", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "Text. Last updated: 2026-11-01."]), /Last updated/],
    ["a second date in a list item", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "- last updated: 2026-11-01"]), /Last updated/],
    ["a second date with a space before the colon", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "Last updated : 2026-11-01"]), /Last updated/],
    ["a second date with two spaces inside the phrase", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "Last  updated: 2026-11-01"]), /Last updated/],
    ["a second date broken across a tab and a line", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "Text. Last\tupdated\n: 2026-11-01"]), /Last updated/],
    ["a date that is not a date", page(["# T", "Description: D.", "Last updated: 2026-13-40", "", "x"]), /Last updated/],
    ["no description", page(["# T", "Last updated: 2026-10-30", "", "x"]), /Description/],
    ["a link to a page that does not exist", page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "[gone](/nowhere)"]), /nowhere/],
  ])("refuses %s", (_name, text, message) => {
    expect(() => P.parsePage("t", text, KNOWN)).toThrow(message);
  });

  it("escapes an ampersand once in the title, every title tag and the body", () => {
    const text = page(["# Terms & Privacy", "Description: Rules & rights.", "Last updated: 2026-10-30", "", "Fees & refunds, see [terms & more](https://example.org/?a=1&b=2)."]);
    const html = P.renderAll({ ...P.readSources(), pages: { ...P.readSources().pages, legal: text } }).get("legal.html") ?? "";
    expect(html).toContain("<title>Terms &amp; Privacy | EmberWalk</title>");
    expect(html).toContain('<meta property="og:title" content="Terms &amp; Privacy | EmberWalk">');
    expect(html).toContain('<meta name="twitter:title" content="Terms &amp; Privacy | EmberWalk">');
    expect(html).toContain('<h1 class="rise">Terms &amp; Privacy</h1>');
    expect(html).toContain('<meta name="description" content="Rules &amp; rights.">');
    expect(html).toContain('<p class="rise">Fees &amp; refunds, see <a href="https://example.org/?a=1&amp;b=2">terms &amp; more</a>.</p>');
    expect(html).not.toContain("&amp;amp;");
  });

  it("escapes a double quote in the title and description wherever they land in an attribute", () => {
    const text = page(['# Say "yes" & mean it', 'Description: A "plain" answer.', "Last updated: 2026-10-30", "", "x"]);
    const html = P.renderAll({ ...P.readSources(), pages: { ...P.readSources().pages, quoted: text } }).get("quoted.html") ?? "";
    const title = "Say &quot;yes&quot; &amp; mean it | EmberWalk";
    const attributes = Object.fromEntries([...html.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)">/g)].map((m) => [m[1], m[2]]));
    expect(attributes["og:title"]).toBe(title);
    expect(attributes["twitter:title"]).toBe(title);
    expect(attributes.description).toBe("A &quot;plain&quot; answer.");
    expect(attributes["og:description"]).toBe("A &quot;plain&quot; answer.");
    expect(attributes["twitter:description"]).toBe("A &quot;plain&quot; answer.");
    expect(html).toContain(`<title>${title}</title>`);
  });

  it.each([
    ["a double quote", '[x](https://a"onclick="y)'],
    ["a double quote in a page link", '[x](/privacy"onclick="y)'],
  ])("refuses a link address holding %s", (_name, link) => {
    const text = page(["# T", "Description: D.", "Last updated: 2026-10-30", "", `Go ${link} now.`]);
    expect(() => P.parsePage("t", text, KNOWN)).toThrow(/quote/);
  });

  it("accepts a link to a known page, a mail link and an outside https link", () => {
    const text = page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "[a](/privacy) [b](mailto:hello@emberwalk.app) [c](https://example.org/)"]);
    expect(P.parsePage("t", text, KNOWN).title).toBe("T");
  });

  it("gives every page a unique title, description and canonical URL, and share card tags", () => {
    const out = P.renderAll(P.readSources());
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const [file, html] of out) {
      if (!file.endsWith(".html") || file === "index.html") continue;
      const title =/<title>([^<]+)<\/title>/.exec(html)?.[1];
      const description = /<meta name="description" content="([^"]+)">/.exec(html)?.[1];
      expect(title, file).toBeTruthy();
      expect(description, file).toBeTruthy();
      expect(titles.has(title!), file).toBe(false);
      expect(descriptions.has(description!), file).toBe(false);
      titles.add(title!);
      descriptions.add(description!);
      expect(html).toContain('<meta property="og:image" content="https://emberwalk.app/brand/share-card.png">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      if (file === "404.html") {
        expect(html).toContain('<meta name="robots" content="noindex">');
        expect(html).not.toContain('rel="canonical"');
      } else {
        expect(html).toContain(`<link rel="canonical" href="${P.ORIGIN}/${file.replace(/\.html$/, "")}">`);
      }
    }
  });

  it("points the share card tags at an image of 1200 by 630", () => {
    const png = readFileSync(`${STATIC}public/brand/share-card.png`);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it("ends every page, the landing and privacy pages among them, with one footer whose last element is the seller line", () => {
    const sources = P.readSources();
    const out = P.renderAll(sources);
    expect([...out.keys()]).toEqual(expect.arrayContaining(["index.html", "privacy.html", "404.html"]));
    for (const [file, html] of out) {
      if (!file.endsWith(".html")) continue;
      expect(html.match(/<footer /g)?.length, file).toBe(1);
      const tail = /<footer class="site-footer">([\s\S]*?)<\/footer>\n<\/body>\n<\/html>\n$/.exec(html)?.[1] ?? "";
      expect(tail.trim().endsWith(`<small class="seller">${ENTITY.sellerLine}</small>`), file).toBe(true);
      expect(html, file).toContain('<link rel="stylesheet" href="/pages.css">');
    }
  });

  it("reads the entity block from packages/shared/src/entity.ts", () => {
    expect(P.readSources().entity).toBe(ENTITY);
  });

  it("changes every page's footer when the seller line or the support email changes in the entity block", () => {
    const sources = P.readSources();
    const changed = P.renderAll({ ...sources, entity: { ...sources.entity, sellerLine: "A changed line.", supportEmail: "changed@example.org" } });
    const pages = [...changed].filter(([file]) => file.endsWith(".html"));
    expect(pages.map(([file]) => file)).toEqual(expect.arrayContaining(["index.html", "privacy.html", "404.html"]));
    for (const [file, html] of pages) {
      const footer = /<footer class="site-footer">([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? "";
      expect(footer, file).toContain('<small class="seller">A changed line.</small>');
      expect(footer, file).toContain('<a href="mailto:changed@example.org">changed@example.org</a>');
      expect(footer, file).not.toContain(ENTITY.sellerLine);
    }
  });

  it("keeps the landing page's own Privacy and mail links in main and adds both to its footer", () => {
    const html = P.renderAll(P.readSources()).get("index.html") ?? "";
    const main = /<main>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
    expect(main.match(/href="\/privacy"/g)?.length).toBe(1);
    expect(main.match(/href="mailto:hello@emberwalk\.app"/g)?.length).toBe(1);
  });

  it.each([["index.html"], ["privacy.html"], ["404.html"]])("puts the Privacy Policy and support mail links in the footer of %s", (file) => {
    const sources = P.readSources();
    const html = P.renderAll(sources).get(file) ?? "";
    const footer = footerOf(html);
    expect(footer).toContain('<a href="/privacy">Privacy Policy</a>');
    expect(footer).toContain(`<a href="mailto:${sources.entity.supportEmail}">${sources.entity.supportEmail}</a>`);
    expect(footer.indexOf("footer-links")).toBeLessThan(footer.indexOf('class="seller"'));
  });

  it("adds to the landing page only the footer and the pages.css link, and nothing else", () => {
    const sources = P.readSources();
    const committed = readFileSync(`${STATIC}public/index.html`, "utf8");
    const link = '  <link rel="stylesheet" href="/pages.css">\n';
    const footer = / {2}<footer class="site-footer">\n[\s\S]*?\n {2}<\/footer>\n/.exec(committed)?.[0] ?? "";
    expect(footer).not.toBe("");
    const bare = committed.replace(footer, "").replace(link, "");
    const rendered = P.renderAll({ ...sources, indexHtml: bare }).get("index.html") ?? "";
    expect(rendered).toBe(committed);
    expect(rendered.length).toBe(bare.length + footer.length + link.length);
    expect(P.renderAll({ ...sources, indexHtml: rendered }).get("index.html")).toBe(rendered);
  });

  const SITE_CSS = '  <link rel="stylesheet" href="/site.css">\n';
  it.each([
    ["no closing body tag", (html: string) => html.replace("</body>", "")],
    ["two closing body tags", (html: string) => html.replace("</body>", "</body>\n</body>")],
    ["no site.css link", (html: string) => html.replace(SITE_CSS, "")],
    ["two site.css links", (html: string) => html.replace(SITE_CSS, SITE_CSS + SITE_CSS)],
  ])("refuses to add the footer to a hand page with %s", (_name, change) => {
    const sources = P.readSources();
    const broken = change(sources.indexHtml);
    expect(broken).not.toBe(sources.indexHtml);
    expect(() => P.renderAll({ ...sources, indexHtml: broken })).toThrow("index.html: needs one site.css link and one closing body tag");
  });

  it("--check exits 0 on the committed files", () => {
    expect(() => execFileSync(process.execPath, [SCRIPT, "--check"], { encoding: "utf8" })).not.toThrow();
  });

  it("--check exits 0 on an exact copy of the committed files", () => {
    expect(checkExit(committedCopy())).toBe(0);
  });

  it("--check exits 1 when a committed rendered file has drifted", () => {
    const dir = committedCopy();
    const before = readFileSync(path.join(dir, "404.html"), "utf8");
    const after = before.replace("Page not found</h1>", "Page not fount</h1>");
    expect(after.length).toBe(before.length);
    expect(after).not.toBe(before);
    writeFileSync(path.join(dir, "404.html"), after);
    expect(checkExit(dir)).toBe(1);
  });

  it.each([
    ["an extra trailing newline", "robots.txt", (text: string) => `${text}\n`],
    ["an extra trailing space", "robots.txt", (text: string) => `${text} `],
    ["a missing trailing newline", "sitemap.xml", (text: string) => text.slice(0, -1)],
    ["a leading space", "404.html", (text: string) => ` ${text}`],
  ])("--check exits 1 when a committed rendered file differs only by %s", (_name, file, change) => {
    const dir = committedCopy();
    const before = readFileSync(path.join(dir, file), "utf8");
    const after = change(before);
    expect(after.trim()).toBe(before.trim());
    writeFileSync(path.join(dir, file), after);
    expect(checkExit(dir)).toBe(1);
  });

  it("--check exits 1 when a rendered file is missing", () => {
    const dir = committedCopy();
    unlinkSync(path.join(dir, "sitemap.xml"));
    expect(checkExit(dir)).toBe(1);
  });
});

describe("entity block in page words", () => {
  const GIVEN = { ...ENTITY, legalName: "A Given Company LLC", supportEmail: "given@example.org" };
  const CONTACT = page(["# Contact", "Description: How to reach us.", "Last updated: 2026-10-30", "", "{{contact}}", "", "These terms are between you and {{legalName}}, the seller of {{productName}}."]);

  it("renders the contact block and the party clause from the entity block", () => {
    const html = P.renderAll({ ...P.readSources(), entity: GIVEN, pages: { ...P.readSources().pages, contact: CONTACT } }).get("contact.html") ?? "";
    expect(html).toContain('<p class="rise contact">A Given Company LLC<br><a href="mailto:given@example.org">given@example.org</a></p>');
    expect(html).toContain(`<p class="rise">These terms are between you and A Given Company LLC, the seller of ${ENTITY.productName}.</p>`);
    expect(html).not.toContain("{{");
  });

  it("changes the contact block and the party clause when a value in the entity block changes", () => {
    const sources = { ...P.readSources(), pages: { ...P.readSources().pages, contact: CONTACT } };
    const before = P.renderAll({ ...sources, entity: GIVEN }).get("contact.html") ?? "";
    const after = P.renderAll({ ...sources, entity: { ...GIVEN, legalName: "Another Company LLC" } }).get("contact.html") ?? "";
    expect(after).not.toContain("A Given Company LLC");
    expect(after).toContain('<p class="rise contact">Another Company LLC<br>');
    expect(after).toContain("between you and Another Company LLC, the seller");
    expect(after.replaceAll("Another Company LLC", "A Given Company LLC")).toBe(before);
  });

  it.each([
    ["an unknown value", "Write to {{nobody}}.", /unknown entity value: nobody/],
    ["the postal address on a page that is not the Contact page", "Write to {{postalAddress}}.", /postal address is printed on the Contact page only/],
    ["the contact block inside a sentence", "Reach us: {{contact}}", /contact block stands on its own line/],
  ])("refuses %s", (_name, line, message) => {
    const text = page(["# T", "Description: D.", "Last updated: 2026-10-30", "", line]);
    expect(() => P.parsePage("t", text, KNOWN, GIVEN)).toThrow(message);
  });

  it("refuses the postal address in the title or the description of the Contact page", () => {
    const inTitle = page(["# At {{postalAddress}}", "Description: D.", "Last updated: 2026-10-30", "", "Text."]);
    const inDescription = page(["# T", "Description: At {{postalAddress}}.", "Last updated: 2026-10-30", "", "Text."]);
    expect(() => P.parsePage("contact", inTitle, KNOWN, GIVEN)).toThrow(/stays out of the title and description/);
    expect(() => P.parsePage("contact", inDescription, KNOWN, GIVEN)).toThrow(/stays out of the title and description/);
  });

  it("renders the postal address on the Contact page as a marker the Worker fills in, and carries no address itself", () => {
    const text = page(["# Contact", "Description: D.", "Last updated: 2026-10-30", "", "Mail: {{legalName}}, {{postalAddress}}"]);
    const parsed = P.parsePage("contact", text, KNOWN, GIVEN);
    expect(parsed.blocks).toEqual(['<p class="rise">Mail: A Given Company LLC, <span data-postal-address></span></p>']);
  });

  it("refuses an entity value in a page rendered with no entity block", () => {
    const text = page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "{{legalName}}"]);
    expect(() => P.parsePage("t", text, KNOWN)).toThrow(/entity/);
  });
});

describe("deploy check", () => {
  const FILLED = Object.fromEntries(Object.keys(ENTITY).map((key) => [key, `Given ${key}`]));

  it("names every TBD and every draft page", () => {
    const sources = P.readSources();
    const planted = { ...sources, site: { ...sources.site, legalState: "TBD (owner)" }, pages: { ...sources.pages, sample: page(["# T", "Description: D.", "Last updated: 2026-10-30", "", "Price: TBD (owner)"]) } };
    const problems = P.deployProblems(planted);
    expect(problems.some((line) => line.includes("legalState"))).toBe(true);
    expect(problems.some((line) => line.includes("sample"))).toBe(true);
  });

  it.each(Object.keys(ENTITY))("names the entity value %s while it is TBD", (key) => {
    const sources = P.readSources();
    const problems = P.deployProblems({ ...sources, entity: { ...FILLED, [key]: "TBD (owner)" } });
    expect(problems.filter((line) => line.startsWith("entity.ts "))).toEqual([`entity.ts ${key} is TBD`]);
  });

  it("names every entity value that is TBD at once", () => {
    const problems = P.deployProblems({ ...P.readSources(), entity: { ...FILLED, legalName: "TBD (owner)", copyrightLine: "TBD (owner)" } });
    expect(problems).toEqual(expect.arrayContaining(["entity.ts legalName is TBD", "entity.ts copyrightLine is TBD"]));
  });

  it("finds nothing in a source set with no TBD and no draft", () => {
    const sources = P.readSources();
    const pages = Object.fromEntries(Object.entries(sources.pages).map(([name, text]) => [name, text.replace(/^Status: draft\n/m, "").replace(/\[TBD: [^\]]*\]/g, "done")]));
    expect(P.deployProblems({ ...sources, entity: FILLED, pages })).toEqual([]);
  });

  it("--check-deploy exits 0 on the committed sources: every entity value is filled, no page holds a marker and no page is a draft", () => {
    expect(() => execFileSync(process.execPath, [SCRIPT, "--check-deploy"], { encoding: "utf8", stdio: "pipe" })).not.toThrow();
  });

  it("names a page marked as a draft", () => {
    const sources = P.readSources();
    const draft = { ...sources, pages: { ...sources.pages, terms: sources.pages.terms.replace("Last updated:", "Status: draft\nLast updated:") } };
    expect(P.deployProblems(draft)).toContain("pages/terms.md is a draft, not yet approved");
  });

  it("names a TBD marker planted in any page", () => {
    const sources = P.readSources();
    for (const name of PUBLIC_SET) {
      const planted = { ...sources, pages: { ...sources.pages, [name]: `${sources.pages[name]}\n[TBD: planted]\n` } };
      expect(P.deployProblems(planted), name).toContain(`pages/${name}.md holds TBD`);
    }
  });
});

describe("sitemap, robots and security.txt", () => {
  const out = () => P.renderAll(P.readSources());

  it("lists the landing page and every generated page but 404, with the source dates", () => {
    const sources = P.readSources();
    const sitemap = out().get("sitemap.xml") ?? "";
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const generated = Object.keys(sources.pages).filter((name) => name !== "404");
    expect(locs).toEqual([`${P.ORIGIN}/`, ...generated.map((name) => `${P.ORIGIN}/${name}`)]);
    for (const name of generated) {
      const date = /^Last updated: (\S+)$/m.exec(sources.pages[name])?.[1];
      expect(sitemap).toContain(`<loc>${P.ORIGIN}/${name}</loc><lastmod>${date}</lastmod>`);
    }
    expect(sitemap).not.toContain("/404");
  });

  it("allows every crawler and names the sitemap in robots.txt", () => {
    expect(out().get("robots.txt")).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${P.ORIGIN}/sitemap.xml\n`);
  });

  it("writes security.txt with the contact, an expiry under one year on (RFC 9116), the canonical URL and the language", () => {
    const sources = P.readSources();
    const text = out().get(".well-known/security.txt") ?? "";
    expect(text).toContain(`Contact: mailto:${sources.site.securityContact}\n`);
    const expires = new Date(/Expires: (\S+)/.exec(text)?.[1] ?? "");
    const from = new Date(`${sources.site.securityTxtDate}T00:00:00.000Z`);
    const year = new Date(from);
    year.setUTCFullYear(from.getUTCFullYear() + 1);
    expect(expires.getTime()).toBeGreaterThan(from.getTime() + 300 * 86_400_000);
    expect(expires.getTime()).toBeLessThan(year.getTime());
    expect(text).toContain(`Canonical: ${P.ORIGIN}/.well-known/security.txt\n`);
    expect(text).toContain("Preferred-Languages: en\n");
  });
});

describe("the public page set", () => {
  const sources = () => P.readSources();
  const out = () => P.renderAll(sources());
  const html = (name: string) => out().get(`${name}.html`) ?? "";

  it("builds every page of the set, each with one title and a canonical address", () => {
    for (const name of PUBLIC_SET) {
      const page = html(name);
      expect(page, name).not.toBe("");
      expect(page.match(/<h1 /g)?.length, name).toBe(1);
      expect(page, name).toContain(`<link rel="canonical" href="${P.ORIGIN}/${name}">`);
    }
  });

  it("passes the deploy check: no page is a draft, no page or entity value is open, and the rendered pages carry no marker text", () => {
    expect(P.deployProblems(sources())).toEqual([]);
    for (const name of [...PUBLIC_SET, "404"]) expect(html(name), name).not.toMatch(/TBD|\{\{/);
  });

  it("links Pricing, Terms, Privacy and Refunds from the footer of every page, each to a page that exists", () => {
    const files = [...out()].filter(([file]) => file.endsWith(".html"));
    expect(files.length).toBeGreaterThanOrEqual(PUBLIC_SET.length + 2);
    const served = new Set(files.map(([file]) => (file === "index.html" ? "/" : `/${file.replace(/\.html$/, "")}`)));
    for (const [file, page] of files) {
      const paths = footerPaths(page);
      for (const name of FOOTER_SET) expect(paths, file).toContain(`/${name}`);
      for (const path of paths) expect(served.has(path), `${file} links ${path}`).toBe(true);
    }
  });

  it("links every page of the set from every footer", () => {
    for (const [file, page] of out()) {
      if (!file.endsWith(".html")) continue;
      for (const name of PUBLIC_SET) expect(footerPaths(page), file).toContain(`/${name}`);
    }
  });

  it("refuses to render while a page the footer links to is missing", () => {
    for (const name of FOOTER_SET) {
      const rest = Object.fromEntries(Object.entries(sources().pages).filter(([key]) => key !== name));
      expect(() => P.renderAll({ ...sources(), pages: rest }), name).toThrow(new RegExp(`/${name}`));
    }
    const only404 = { "404": sources().pages["404"] };
    expect(() => P.renderAll({ ...sources(), pages: only404 })).toThrow(/footer: the page it links to does not exist: \/pricing/);
  });

  it("names no availability date, and none of the sentences held back until the crews are built", () => {
    const held: string[] = JSON.parse(readFileSync(`${STATIC}test/browser/approved-copy.json`, "utf8")).held;
    expect(held.length).toBeGreaterThan(0);
    for (const name of PUBLIC_SET) {
      const text = bodyText(html(name));
      expect(text, name).not.toMatch(/\b(Nov(ember|\.)?|Oct(ober|\.)?)\s*\d/i);
      expect(text, name).not.toMatch(/\b(available|availability|go(es)? live)\b/i);
      for (const sentence of held) expect(text, name).not.toContain(sentence.split(". ")[0]);
    }
  });

  it("names no provider the code does not call and writes no em or en dash", () => {
    for (const [name, text] of Object.entries(sources().pages)) {
      expect(text, name).not.toMatch(/cartesia|esri/i);
      expect(text, name).not.toMatch(/[–—]/);
    }
  });

  it("keeps the postal address out of every file: the entity block has none, only the Contact page asks for it, and the generated page holds a marker", () => {
    expect(Object.keys(ENTITY)).not.toContain("postalAddress");
    for (const name of PUBLIC_SET.filter((key) => key !== "contact")) {
      expect(sources().pages[name], name).not.toContain("{{postalAddress}}");
      expect(html(name), name).not.toContain("data-postal-address");
    }
    expect(sources().pages.contact.match(/\{\{postalAddress\}\}/g)).toHaveLength(1);
    expect(html("contact").match(/<span data-postal-address><\/span>/g)).toHaveLength(1);
  });

  it("puts the mailing address under the email on the Contact page", () => {
    const text = bodyText(html("contact"));
    expect(text.indexOf(ENTITY.supportEmail)).toBeGreaterThan(-1);
    expect(text.indexOf(`Mail: ${ENTITY.legalName},`)).toBeGreaterThan(text.indexOf(ENTITY.supportEmail));
  });
});

describe("the approved Privacy sentences (Oct. 26th)", () => {
  const APPROVED = [
    "When you sign up, you give us two things: your email address, and whether you are a homeowner, a landlord or property manager, or something else. We also keep the date and time you signed up. We do not ask for your name, your address, your phone number or your location.",
    "We use your email address to tell you when EmberWalk launches and to send you the confirmation email. We use your answer to understand who EmberWalk is for. We'll only email you about EmberWalk.",
    "Your email address and answer are stored with Cloudflare, which hosts this site. The confirmation email is sent through Resend. Cloudflare Turnstile checks that a person, and not a program, is using the sign up form; it runs in your browser when you use the form. These companies handle your information only to do those jobs for us.",
    "We never sell your information, and we never share it for advertising.",
    "This site sets no cookies of its own and has no advertising and no analytics. We do not track you across other websites, so a Do Not Track signal from your browser changes nothing here.",
    "Cloudflare Turnstile sees your IP address and browser details, and may set a strictly necessary cookie, only to check you are a person. No other company tracks you across sites through EmberWalk.",
    "Every email we send has an unsubscribe link. Using it removes you straight away, with nothing to sign in to. You can also write to hello@emberwalk.app from the address you signed up with and ask to be removed. We will delete your email address and your answer from the list. To see what we hold about you, or to correct it, write to the same address.",
    "EmberWalk is not meant for children under 13. If you tell us a child signed up, we delete it.",
    "If we change this page, we will change the date below.",
  ];

  it("stay in the rendered Privacy page word for word", () => {
    const text = bodyText(P.renderAll(P.readSources()).get("privacy.html") ?? "");
    for (const sentence of APPROVED) expect(text, sentence.slice(0, 40)).toContain(sentence);
  });

  it("fail when one word of the source changes", () => {
    const sources = P.readSources();
    const changed = { ...sources, pages: { ...sources.pages, privacy: sources.pages.privacy.replace("only to do those jobs for us", "to do the jobs we give them") } };
    const text = bodyText(P.renderAll(changed).get("privacy.html") ?? "");
    expect(APPROVED.every((sentence) => text.includes(sentence))).toBe(false);
  });
});

describe("pricing", () => {
  const html = (offers: Offers = OFFER_CONFIG) => P.renderAll({ ...P.readSources(), offers }).get("pricing.html") ?? "";
  const [individual, landlord] = OFFER_CONFIG.offers;

  it("shows each plan's price and walks from the shared plan config, and the extra walk price", () => {
    const text = bodyText(html());
    expect(text).toContain(`${dollars(individual.amountCents)} a year`);
    expect(text).toContain(`${dollars(landlord.amountCents)} a year`);
    expect(text).toContain(`${individual.walksPerYear} walks a year`);
    expect(text).toContain(`${landlord.walksPerYear} walks a year`);
    expect(text).toContain(`${dollars(OFFER_CONFIG.extraWalk.amountCents)} each`);
  });

  it("changes with the plan config and nothing else changes", () => {
    const changed: Offers = {
      ...OFFER_CONFIG,
      offers: [
        { ...individual, amountCents: 1111, walksPerYear: 7 },
        { ...landlord, amountCents: 2222, walksPerYear: 33 },
      ],
      extraWalk: { ...OFFER_CONFIG.extraWalk, amountCents: 444 },
    };
    const after = html(changed);
    expect(after).toContain("$11.11 a year");
    expect(after).toContain("$22.22 a year");
    expect(after).toContain("7 walks a year");
    expect(after).toContain("33 walks a year");
    expect(after).toContain("$4.44 each");
    for (const old of [dollars(individual.amountCents), dollars(landlord.amountCents), dollars(OFFER_CONFIG.extraWalk.amountCents)]) expect(after).not.toContain(old);
    const restored = after.replaceAll("$11.11", dollars(individual.amountCents)).replaceAll("$22.22", dollars(landlord.amountCents)).replaceAll("$4.44", dollars(OFFER_CONFIG.extraWalk.amountCents)).replaceAll(" 7 walks", ` ${individual.walksPerYear} walks`).replaceAll(" 33 walks", ` ${landlord.walksPerYear} walks`);
    expect(restored.replace(/\s+/g, " ")).toBe(html().replace(/\s+/g, " "));
  });

  it("says that unused extra walks carry into the next plan year on both plans (owner's ruling)", () => {
    expect(bodyText(html())).toMatch(/unused extra walks carry over into the next plan year/i);
    expect(bodyText(html())).toMatch(/either plan|both plans/i);
  });

  it("states the most extra walks in one purchase as the number checkout accepts: that many pass, one more is refused", () => {
    expect(bodyText(html())).toContain(`up to ${MAX_EXTRA_WALKS} in one purchase`);
    expect(ExtraWalksRequest.safeParse({ count: MAX_EXTRA_WALKS }).success).toBe(true);
    expect(ExtraWalksRequest.safeParse({ count: MAX_EXTRA_WALKS + 1 }).success).toBe(false);
  });

  it("says the new year's plan walks are used before carried over extra walks, and says carry over only while the plan config carries extras over", () => {
    expect(OFFER_CONFIG.extraWalk.carryOver).toBe(true);
    const text = bodyText(html());
    expect(text).toMatch(/When a plan renews, the new year's plan walks are used before any carried over extra walks/);
    expect(text).toMatch(/unused extra walks carry over into the next plan year/i);
  });

  it("says a plan renews on its own each year until it is cancelled, and points to the refund and cancellation page", () => {
    const text = bodyText(html());
    expect(text).toMatch(/renews on its own (every|each) year until you cancel/i);
    expect(P.readSources().pages.pricing).not.toMatch(/\[TBD: whether a plan renews/);
    expect(html()).toContain('href="/refunds"');
  });

  it("names no building count and offers nothing free", () => {
    const text = bodyText(html());
    expect(text).not.toMatch(/\d+\s+(buildings|properties|homes|houses)/i);
    expect(text).not.toMatch(/\bfree\b/i);
    expect(text).not.toMatch(/\b(judge|promo|coupon)\b/i);
  });

  it("lists what each plan includes, says only a walk uses up a walk, and names nothing that is switched off", () => {
    expect(OFFER_CONFIG.paidExtras).toBeNull();
    const text = bodyText(html());
    for (const item of [/blurred proof pictures/i, /recheck photos/i, /Get It Fixed/, /Delete Everything/]) expect(text).toMatch(item);
    expect(text).toMatch(/only a walk uses up one of your walks/i);
    expect(text).not.toMatch(/PDF|share link|Defensible Space Record/i);
    expect(P.readSources().pages.pricing).not.toMatch(/\[TBD: what each plan includes/);
  });
});

describe("refunds and terms", () => {
  const sources = () => P.readSources();

  const refunds = () => bodyText(P.renderAll(sources()).get("refunds.html") ?? "");

  it("says a full refund of a plan stops new walks on that plan, only for the period it paid for, and cancels its renewal", () => {
    expect(refunds()).toMatch(/full refund of a plan stops new walks on that plan/i);
    expect(refunds()).toMatch(/only the plan period that charge paid for/i);
    expect(refunds()).toMatch(/refund a plan, we also cancel its renewal/i);
  });

  it("says any refund on an extra walk purchase, partial or full, voids that whole purchase", () => {
    expect(refunds()).toMatch(/refund on an extra walk purchase, partial or full, voids that whole purchase/i);
  });

  it("gives a refund window, who qualifies, how to ask from the contact block, and how long it takes", () => {
    const text = refunds();
    expect(text).toMatch(/within 14 days of a charge/i);
    expect(text).toMatch(/extra walks[^.]*if you have not used any of them/i);
    expect(text).toMatch(/Stripe receipt/i);
    expect(text).toMatch(/5 to 10 business days/i);
    expect(sources().pages.refunds).toMatch(/^\{\{contact\}\}$/m);
    expect(sources().pages.refunds).not.toMatch(/\[TBD: the refund window/);
  });

  it("explains renewal, the notice before it, how to cancel and what happens to the rest of the year", () => {
    const text = refunds();
    expect(text).toMatch(/renews on its own every year/i);
    expect(text).toMatch(/30 days before/i);
    expect(text).toMatch(/cancel any time/i);
    expect(text).toMatch(/keep your walks until the end of the year you paid for/i);
    expect(text).toMatch(/rest of a paid year is not refunded/i);
    expect(sources().pages.refunds).not.toMatch(/\[TBD: whether a plan renews/);
  });

  it("says users get an email at least 30 days before a change to the terms that matters", () => {
    const text = bodyText(P.renderAll(sources()).get("terms.html") ?? "");
    expect(text).toMatch(/We email you at least 30 days before a change to these terms that matters/);
    expect(text).not.toMatch(/change the date below/i);
    expect(text).toMatch(/Each policy page on this site shows the date it was last updated/);
    expect(text).not.toMatch(/Each page on this site shows/);
  });

  it("shows a last updated date on every page of the set, once, and on no page twice", () => {
    for (const name of PUBLIC_SET) {
      const page = P.renderAll(sources()).get(`${name}.html`) ?? "";
      expect(page.match(/<p class="rise updated">Last updated: [^<]+\.<\/p>/g), name).toHaveLength(1);
    }
  });

  it("sets the Terms' age floor, the grant for walk video and photos, governing law and the cap on responsibility", () => {
    const text = bodyText(P.renderAll(sources()).get("terms.html") ?? "");
    expect(text).toMatch(/You must be 18 or older to buy or use EmberWalk/);
    expect(text).toMatch(/You keep ownership of your walk video, sound and photos/);
    expect(text).toMatch(/only to check your walk, list what it finds and do what you ask in the app/);
    expect(text).not.toMatch(/make your report/i);
    expect(text).toMatch(/California law governs these terms/);
    expect(text).toMatch(/no required arbitration/);
    expect(text).toMatch(/greater of \$50 or what you paid us in the 12 months before the claim/);
    expect(text).toMatch(/indirect losses/);
    expect(text).toMatch(/fraud or willful harm/);
    expect(text).not.toMatch(/train models/i);
  });

  it("promises no report, PDF or share link on any page while the API Worker config has the report off", () => {
    const config = readFileSync(`${STATIC}../api/wrangler.jsonc`, "utf8");
    expect(config).toMatch(/"REPORT":\s*"off"/);
    for (const name of PUBLIC_SET) {
      expect(bodyText(P.renderAll(sources()).get(`${name}.html`) ?? ""), name).not.toMatch(/your report|\bPDF\b|share link/i);
    }
  });

  it("states the accessibility standard as WCAG 2.2 level AA that EmberWalk aims at, and the known gaps", () => {
    const text = bodyText(P.renderAll(sources()).get("accessibility.html") ?? "");
    expect(text).toMatch(/aims to meet the Web Content Accessibility Guidelines \(WCAG\) 2\.2, level AA/);
    expect(text).toMatch(/not finished a test with a screen reader/i);
    expect(sources().pages.accessibility).not.toMatch(/\[TBD:/);
  });

  it("says a failed walk does not count and can be tried again until it completes", () => {
    const text = bodyText(P.renderAll(sources()).get("pricing.html") ?? "");
    expect(text).toMatch(/walk that fails does not count/i);
    expect(text).toMatch(/until it completes/i);
  });

  it("says EmberWalk is not an inspection and does not perform or schedule one", () => {
    for (const name of ["terms", "about"]) {
      const text = bodyText(P.renderAll(sources()).get(`${name}.html`) ?? "");
      expect(text, name).toMatch(/not (a fire department )?inspection/i);
      expect(text, name).toMatch(/does not (perform or schedule|schedule or perform)/i);
    }
  });

  it("takes the Terms' party clause and the Contact block from the entity block, and a changed legal name changes both", () => {
    const given = { ...ENTITY, legalName: "A Given Company LLC", supportEmail: "given@example.org" };
    const before = P.renderAll({ ...sources(), entity: given });
    const after = P.renderAll({ ...sources(), entity: { ...given, legalName: "Another Company LLC" } });
    for (const name of ["terms", "contact"]) {
      const a = before.get(`${name}.html`) ?? "";
      const b = after.get(`${name}.html`) ?? "";
      expect(a, name).toContain("A Given Company LLC");
      expect(b, name).toContain("Another Company LLC");
      expect(b, name).not.toContain("A Given Company LLC");
      expect(b.replaceAll("Another Company LLC", "A Given Company LLC"), name).toBe(a);
    }
    expect(before.get("contact.html")).toContain('<a href="mailto:given@example.org">given@example.org</a>');
  });

});
