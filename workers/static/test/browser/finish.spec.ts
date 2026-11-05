import { expect, test, type Page } from "@playwright/test";
import { settle, stubTurnstile } from "./helpers";

const LANDINGS = [
  { language: "English", path: "/" },
  { language: "Spanish", path: "/?lang=es" },
];

const TARGET = 44;

type Box = { label: string; left: number; top: number; right: number; bottom: number };

async function boxes(page: Page, selector: string): Promise<Box[]> {
  return page.$$eval(selector, (elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { label: (element.textContent ?? "").trim(), left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    }),
  );
}

async function risen(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForFunction((at) => {
    const element = document.querySelector(at)!;
    return getComputedStyle(element).transform === "none" && getComputedStyle(element).opacity === "1";
  }, selector);
}

const overlap = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;

function expectApart(list: Box[]) {
  for (const [i, a] of list.entries()) {
    for (const b of list.slice(i + 1)) expect(overlap(a, b), `${a.label} and ${b.label} overlap`).toBe(false);
  }
}

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page);
});

for (const { language, path } of LANDINGS) {
  test.describe(`${language} landing finish`, () => {
    test("gives every link in the signup card and the footer a 44 px tap target, none overlapping", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await risen(page, ".signup-card");
      const card = await boxes(page, ".signup-card p a, .signup-card nav.language a, .signup-card a.button");
      const footer = await boxes(page, "footer nav.footer-links a");
      expect(card.length, "links in the signup card").toBeGreaterThanOrEqual(5);
      expect(footer.length, "links in the footer").toBeGreaterThanOrEqual(9);
      for (const box of [...card, ...footer]) {
        expect(box.bottom - box.top, `${box.label} height`).toBeGreaterThanOrEqual(TARGET);
        expect(box.right - box.left, `${box.label} width`).toBeGreaterThanOrEqual(TARGET);
      }
      expectApart(card);
      expectApart(footer);
    });

    test("spaces the signup card's fine print evenly, each link on its own centred line", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await risen(page, ".signup-card");
      const notes = await page.$$eval(".signup-card p.fine:has(a)", (paragraphs) =>
        paragraphs.map((paragraph) => {
          const lines: number[] = [];
          for (const node of paragraph.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim() === "") continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) if (rect.width > 1 && !lines.some((top) => Math.abs(top - rect.top) < 2)) lines.push(rect.top);
          }
          lines.sort((a, b) => a - b);
          const card = paragraph.closest(".signup-card")!.getBoundingClientRect();
          const link = paragraph.querySelector("a")!.getBoundingClientRect();
          const textBottom = Math.max(...[...paragraph.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "").flatMap((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].map((rect) => rect.bottom);
          }));
          return {
            label: (paragraph.textContent ?? "").trim().slice(0, 30),
            pitches: lines.slice(1).map((top, i) => top - lines[i]!),
            lineHeight: parseFloat(getComputedStyle(paragraph).lineHeight),
            linkBelowText: link.top >= textBottom - 1,
            offCentre: link.left + link.width / 2 - (card.left + card.width / 2),
          };
        }),
      );
      expect(notes.length, "fine print paragraphs with a link").toBe(2);
      for (const note of notes) {
        expect(note.linkBelowText, `${note.label}: the link sits on its own line, below the words`).toBe(true);
        expect(Math.abs(note.offCentre), `${note.label}: the link is centred in the card`).toBeLessThanOrEqual(2);
        for (const pitch of note.pitches) expect(Math.abs(pitch - note.lineHeight), `${note.label}: line spacing ${note.pitches.join(", ")} against ${note.lineHeight}`).toBeLessThanOrEqual(1);
      }
    });

    test("renders no text smaller than 12 px", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const small = await page.evaluate((floor) =>
        [...document.querySelectorAll("body *")]
          .filter((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== ""))
          .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden")
          .map((element) => {
            const svg = element instanceof SVGElement ? (element as SVGGraphicsElement).getScreenCTM?.() : null;
            const size = parseFloat(getComputedStyle(element).fontSize) * (svg ? Math.hypot(svg.a, svg.b) : 1);
            return { size, label: `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""} "${(element.textContent ?? "").trim().slice(0, 30)}"` };
          })
          .filter(({ size }) => size < floor - 0.01)
          .map(({ size, label }) => `${label} ${size.toFixed(2)} px`),
      12);
      expect(small).toEqual([]);
    });

    test("keeps each zone label inside its own band, clear of the band edges and the roof", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await page.locator("figure.zones").scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("figure.zones .band")].every((band) => band.getAnimations().every((animation) => animation.playState !== "running")),
      );
      const labels = await page.evaluate(() => {
        const svg = document.querySelector("figure.zones svg") as SVGSVGElement;
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        const halfStroke = (element: Element) => parseFloat(getComputedStyle(element).strokeWidth) / 2;
        const roof = svg.querySelector(".house .roof") as SVGGraphicsElement;
        const outer = [".b5", ".b30", ".b100"].map((band) => {
          const edge = svg.querySelector(`${band} .edge`) as SVGGraphicsElement;
          return edge.getBBox().y - halfStroke(edge);
        });
        const inner = [roof.getBBox().y - halfStroke(roof), outer[0]!, outer[1]!];
        return [...svg.querySelectorAll("text.tag")].map((tag, i) => {
          const box = (tag as SVGGraphicsElement).getBBox();
          return { label: tag.textContent ?? "", above: (box.y - outer[i]!) * scale, below: (inner[i]! - (box.y + box.height)) * scale };
        });
      });
      expect(labels).toHaveLength(3);
      for (const label of labels) {
        expect(label.above, `${label.label}: clear space above, px`).toBeGreaterThanOrEqual(2);
        expect(label.below, `${label.label}: clear space below, px`).toBeGreaterThanOrEqual(2);
      }
    });

    test("shows no house apart card under the section that rises over it, at any scroll position", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await page.waitForSelector("#apart.pinned");
      const [from, to] = await page.evaluate(() => {
        const apart = document.getElementById("apart")!;
        const end = apart.offsetTop + apart.offsetHeight;
        return [end - innerHeight - 200, end + 100];
      });
      const seen: string[] = [];
      for (let y = from; y <= to; y += 40) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(300);
        const under = await page.evaluate(() => {
          const shown = (element: Element) => {
            let alpha = 1;
            for (let at: Element | null = element; at; at = at.parentElement) alpha *= Number(getComputedStyle(at).opacity);
            return alpha;
          };
          const cover = document.getElementById("apart")!.nextElementSibling!.getBoundingClientRect().top;
          return [...document.querySelectorAll("#apart .apart-cards .card, #apart .apart-cards .card > *")]
            .map((element) => ({ element, box: element.getBoundingClientRect() }))
            .filter(({ element, box }) => shown(element) > 0.02 && box.height > 0 && box.bottom > cover && box.top < innerHeight)
            .map(({ element, box }) => `${element.tagName} "${(element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(box.bottom - cover)} px under the rising section`);
        });
        if (under.length > 0) seen.push(`at scroll ${y}: ${under.join("; ")}`);
      }
      expect(seen).toEqual([]);
    });

    test("leaves no console error once the edge has had its chance to add its analytics script", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/\/(\?lang=es)?$/, async (route) => {
        const response = await route.fetch();
        const kept = (response.headers()["cache-control"] ?? "").split(",").some((part) => part.trim() === "no-transform");
        const body = await response.text();
        await route.fulfill({
          response,
          body: kept ? body : body.replace("</body>", '<script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script></body>'),
        });
      });
      await page.route("https://static.cloudflareinsights.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
      await page.goto(path);
      await settle(page);
      expect(errors).toEqual([]);
    });
  });
}

test("the /es address opens the Spanish landing page", async ({ page }) => {
  for (const address of ["/es", "/es/"]) {
    const response = await page.goto(address);
    expect(response?.status(), address).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  }
});

for (const path of ["/privacy", "/pricing"]) {
  test(`gives every footer link on ${path} a 44 px tap target, none overlapping`, async ({ page }) => {
    await page.goto(path);
    await settle(page);
    const footer = await boxes(page, "footer nav.footer-links a");
    expect(footer.length).toBeGreaterThanOrEqual(9);
    for (const box of footer) {
      expect(box.bottom - box.top, `${box.label} height`).toBeGreaterThanOrEqual(TARGET);
      expect(box.right - box.left, `${box.label} width`).toBeGreaterThanOrEqual(TARGET);
    }
    expectApart(footer);
  });
}
