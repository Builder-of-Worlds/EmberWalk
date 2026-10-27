import { expect, test, type Page } from "@playwright/test";
import { HEADLINE } from "../../scripts/brand.mjs";

const SITE = "https://emberwalk.app/";
const SHARE_CARD = `${SITE}brand/share-card.png`;

const PAGES = [
  { path: "/", url: SITE, title: "EmberWalk | Get your home ready for wildfire season" },
  { path: "/privacy", url: `${SITE}privacy`, title: "EmberWalk privacy policy" },
];

async function headTags(page: Page) {
  return page.evaluate(() => {
    const meta: Record<string, string> = {};
    for (const element of document.head.querySelectorAll("meta[property], meta[name]")) {
      meta[element.getAttribute("property") ?? element.getAttribute("name") ?? ""] = element.getAttribute("content") ?? "";
    }
    const links = [...document.head.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon']")].map((element) => ({
      rel: element.getAttribute("rel"),
      href: (element as HTMLLinkElement).href,
      type: element.getAttribute("type"),
      sizes: element.getAttribute("sizes"),
    }));
    return { meta, links };
  });
}

function local(url: string, baseURL: string) {
  return url.startsWith(SITE) ? new URL(url.slice(SITE.length - 1), baseURL).href : url;
}

for (const { path, url, title } of PAGES) {
  test.describe(`${path} head`, () => {
    test("names the tab icons, the touch icon and the theme colour", async ({ page, baseURL }) => {
      await page.goto(path);
      const { meta, links } = await headTags(page);
      expect(links).toEqual([
        { rel: "icon", href: `${baseURL}/brand/icon-32.png`, type: "image/png", sizes: "32x32" },
        { rel: "icon", href: `${baseURL}/brand/icon.svg`, type: "image/svg+xml", sizes: null },
        { rel: "apple-touch-icon", href: `${baseURL}/brand/apple-touch-icon.png`, type: null, sizes: null },
      ]);
      expect(meta["theme-color"]).toMatch(/^#[0-9a-f]{6}$/);
    });

    test("carries the share tags with absolute emberwalk.app addresses", async ({ page }) => {
      await page.goto(path);
      const { meta } = await headTags(page);
      expect(meta).toMatchObject({
        "og:type": "website",
        "og:site_name": "EmberWalk",
        "og:url": url,
        "og:title": title,
        "og:image": SHARE_CARD,
        "og:image:type": "image/png",
        "og:image:width": "1200",
        "og:image:height": "630",
        "twitter:card": "summary_large_image",
        "twitter:title": title,
        "twitter:image": SHARE_CARD,
      });
      expect(meta["og:description"]).toBe(meta["description"]);
      expect(meta["twitter:description"]).toBe(meta["description"]);
      expect(meta["og:image:alt"]).toContain(HEADLINE);
      expect(meta["twitter:image:alt"]).toBe(meta["og:image:alt"]);
      for (const [name, value] of Object.entries(meta)) {
        if (/^https?:/.test(value)) expect(value.startsWith(SITE), name).toBe(true);
      }
    });

    test("names only addresses that answer with the right kind of file", async ({ page, request, baseURL }) => {
      await page.goto(path);
      const { meta, links } = await headTags(page);
      const named = [
        ...links.map((link) => ({ from: link.rel!, url: link.href, type: link.type ?? "image/png" })),
        { from: "og:url", url: meta["og:url"], type: "text/html" },
        { from: "og:image", url: meta["og:image"], type: meta["og:image:type"] },
        { from: "twitter:image", url: meta["twitter:image"], type: "image/png" },
      ];
      for (const { from, url: address, type } of named) {
        const response = await request.get(local(address, baseURL!));
        expect(response.status(), `${from} ${address}`).toBe(200);
        expect(response.headers()["content-type"], `${from} ${address}`).toContain(type);
      }
    });

    test("decodes every icon it names as an image inside the page", async ({ page }) => {
      await page.goto(path);
      const { links } = await headTags(page);
      const loaded = await page.evaluate(async (hrefs) => {
        const sizes = [];
        for (const href of hrefs) {
          const image = new Image();
          image.src = href;
          await image.decode();
          sizes.push([image.naturalWidth, image.naturalHeight]);
        }
        return sizes;
      }, links.map((link) => link.href));
      expect(loaded.every(([width, height]) => width > 0 && height > 0)).toBe(true);
    });
  });
}

test("the headline the share card is drawn from is the landing headline word for word", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(HEADLINE);
});
