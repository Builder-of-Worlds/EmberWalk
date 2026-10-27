import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { clearSignups, deps, fakeMailer, fakeVerify, rows, testEnv } from "./helpers";

function get(path: string, method = "GET") {
  return handle(new Request(`https://emberwalk.app${path}`, { method }), testEnv(), deps(fakeVerify(), fakeMailer()));
}

function directives(csp: string) {
  return new Map(csp.split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values] as const;
  }));
}

describe("pages and headers", () => {
  it.each(["/", "/privacy"])("serves %s as HTML with the security headers", async (path) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("allows scripts only from the site and the Turnstile host, and no inline script or style", async () => {
    const csp = directives((await get("/")).headers.get("content-security-policy") ?? "");
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(csp.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(csp.get("style-src")).toEqual(["'self'"]);
    expect(csp.get("font-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    for (const values of csp.values()) {
      expect(values).not.toContain("'unsafe-inline'");
      expect(values).not.toContain("'unsafe-eval'");
    }
  });

  it("serves the font license beside the font files", async () => {
    const response = await get("/fonts/OFL.txt");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("SIL Open Font License");
  });

  it("answers a missing page with 404", async () => {
    expect((await get("/no-such-page")).status).toBe(404);
  });

  it("returns the public Turnstile site key at /api/config and nothing secret", async () => {
    const response = await get("/api/config");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ turnstileSiteKey: testEnv().TURNSTILE_SITE_KEY });
  });

  it("serves GET /api/config only", async () => {
    expect((await get("/api/config", "POST")).status).toBe(405);
  });
});

function documented(name: string) {
  const block = new RegExp("```sql " + name + "\\n([\\s\\S]*?)```").exec(env.README_TEXT);
  expect(block, `README.md must hold a fenced sql ${name} block`).not.toBeNull();
  return block![1].trim();
}

describe("what the list holds", () => {
  beforeEach(async () => {
    await clearSignups(testEnv().DB);
  });

  it("has exactly an id, the email, the role and two dates", async () => {
    const info = await testEnv().DB.prepare("PRAGMA table_info(signups)").all<{ name: string }>();
    expect(info.results.map((column) => column.name).sort()).toEqual(["created_at", "email", "id", "role", "welcomed_at"]);
  });

  it("refuses a second row for the same address and a role outside the three", async () => {
    const db = testEnv().DB;
    await db.prepare("INSERT INTO signups (email, role) VALUES ('a@example.com', 'other')").run();
    await expect(db.prepare("INSERT INTO signups (email, role) VALUES ('a@example.com', 'other')").run()).rejects.toThrow();
    await expect(db.prepare("INSERT INTO signups (email, role) VALUES ('b@example.com', 'boss')").run()).rejects.toThrow();
    await expect(db.prepare("INSERT INTO signups (email, role) VALUES ('C@Example.com', 'other')").run()).rejects.toThrow();
  });

  it("removes one person through the documented command and leaves the others", async () => {
    const statement = documented("removal").replace("person@example.com", "Gone@Example.com");

    const db = testEnv().DB;
    await db.prepare("INSERT INTO signups (email, role) VALUES ('gone@example.com', 'other'), ('stay@example.com', 'homeowner')").run();
    await db.prepare(statement).run();
    expect((await rows(db)).map((row) => row.email)).toEqual(["stay@example.com"]);
  });

  it("shows what is held about one person through the documented command and nobody else", async () => {
    const statement = documented("access").replace("person@example.com", "Seen@Example.com");
    const db = testEnv().DB;
    await db.prepare("INSERT INTO signups (email, role) VALUES ('seen@example.com', 'landlord'), ('other@example.com', 'homeowner')").run();
    const found = await db.prepare(statement).all<{ email: string; role: string; created_at: string }>();
    expect(found.results).toHaveLength(1);
    expect(found.results[0]).toMatchObject({ email: "seen@example.com", role: "landlord" });
    expect(found.results[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("corrects the role of one person through the documented command and leaves the others", async () => {
    const statement = documented("correction").replace("person@example.com", "Fixed@Example.com").replace("'other'", "'landlord'");
    const db = testEnv().DB;
    await db.prepare("INSERT INTO signups (email, role) VALUES ('fixed@example.com', 'other'), ('same@example.com', 'other')").run();
    await db.prepare(statement).run();
    expect((await rows(db)).map((row) => [row.email, row.role])).toEqual([
      ["fixed@example.com", "landlord"],
      ["same@example.com", "other"],
    ]);
  });

  it("corrects an address through the documented command and keeps the rules on addresses", async () => {
    const statement = documented("address");
    const db = testEnv().DB;
    await db.prepare("INSERT INTO signups (email, role) VALUES ('old@example.com', 'other')").run();
    await db.prepare(statement.replace("person@example.com", "Old@Example.com").replace("corrected@example.com", "New@Example.com")).run();
    expect((await rows(db)).map((row) => row.email)).toEqual(["new@example.com"]);
  });
});
