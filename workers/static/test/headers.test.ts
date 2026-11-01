import { describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { deps, fakeMailer, fakeVerify, testEnv } from "./helpers";

const CSP =
  "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function get(path: string, method = "GET") {
  return handle(new Request(`https://emberwalk.app${path}`, { method }), testEnv(), deps(fakeVerify(), fakeMailer()));
}

describe("site headers", () => {
  it.each(["/", "/privacy", "/no-such-page", "/sitemap.xml", "/robots.txt", "/.well-known/security.txt", "/api/config", "/api/nothing"])(
    "sends HSTS, the permissions policy and the unchanged CSP on %s",
    async (path) => {
      const response = await get(path);
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
      const policy = response.headers.get("permissions-policy") ?? "";
      for (const feature of ["camera", "microphone", "geolocation", "payment"]) expect(policy).toContain(`${feature}=()`);
      expect(response.headers.get("content-security-policy")).toBe(CSP);
    },
  );

  it("does not ask browsers to preload HSTS", async () => {
    expect((await get("/")).headers.get("strict-transport-security")).not.toContain("preload");
  });
});

describe("missing pages", () => {
  it("answers a missing path with 404 and the generated not found page, never the landing page", async () => {
    const response = await get("/no-such-page");
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(html).toContain("<h1 class=\"rise\">Page not found</h1>");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('id="signup"');
  });
});

describe("crawler files", () => {
  it("serves the sitemap as XML", async () => {
    const response = await get("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("xml");
    expect(await response.text()).toContain("<loc>https://emberwalk.app/privacy</loc>");
  });

  it("serves robots.txt naming the sitemap", async () => {
    const response = await get("/robots.txt");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Sitemap: https://emberwalk.app/sitemap.xml");
  });

  it("serves security.txt at the well known path with the contact", async () => {
    const response = await get("/.well-known/security.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("Contact: mailto:hello@emberwalk.app");
  });
});
