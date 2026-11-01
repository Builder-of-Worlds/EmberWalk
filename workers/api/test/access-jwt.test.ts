import { beforeAll, describe, expect, it } from "vitest";
import { accessConfigOf, createAccessVerifier } from "../src/access-jwt.ts";
import type { AccessConfig } from "../src/access-jwt.ts";
import { AUD, TEAM, b64url, certsEndpoint, claimsAt, makeKey, signToken } from "./ops-token.ts";
import type { TestKey } from "./ops-token.ts";

const NOW = Date.UTC(2026, 9, 30, 20, 0, 0);
const CONFIG: AccessConfig = { teamDomain: TEAM, audience: AUD };

let key: TestKey;
let stranger: TestKey;

beforeAll(async () => {
  key = await makeKey("kid-1");
  stranger = await makeKey("kid-1");
});

const setup = (keys: TestKey[] = [key]) => {
  const certs = certsEndpoint(keys);
  const clock = { now: NOW };
  const verifier = createAccessVerifier({ fetch: certs.fetch, now: () => clock.now });
  return { certs, clock, verify: (token: string | null, config: AccessConfig | null = CONFIG) => verifier.verify(token, config) };
};

const tamper = (token: string, part: 0 | 1, change: (json: Record<string, unknown>) => void): string => {
  const pieces = token.split(".");
  const json = JSON.parse(atob((pieces[part] ?? "").replaceAll("-", "+").replaceAll("_", "/"))) as Record<string, unknown>;
  change(json);
  pieces[part] = b64url(new TextEncoder().encode(JSON.stringify(json)));
  return pieces.join(".");
};

describe("a valid Access token", () => {
  it("passes, with the key fetched from the team's certs address", async () => {
    const { verify, certs } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW)))).toBe(true);
    expect(certs.urls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
  });

  it("passes when the audience is one of several", async () => {
    const { verify } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW, { aud: ["other", AUD] })))).toBe(true);
  });

  it("passes when the audience is a single string and when there is no nbf", async () => {
    const { verify } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW, { aud: AUD, nbf: undefined })))).toBe(true);
  });

  it("fetches the certs once for many tokens", async () => {
    const { verify, certs } = setup();
    for (let i = 0; i < 3; i += 1) expect(await verify(await signToken(key, claimsAt(NOW)))).toBe(true);
    expect(certs.urls).toHaveLength(1);
  });
});

describe("a token that is refused", () => {
  it("refuses a missing, empty or malformed token", async () => {
    const { verify } = setup();
    for (const token of [null, "", "abc", "a.b", "a.b.c.d", "...", "not.a.jwt"]) expect(await verify(token)).toBe(false);
  });

  it("refuses alg none and HS256 even when the rest is right", async () => {
    const { verify } = setup();
    for (const alg of ["none", "HS256", "RS512", "rs256"]) {
      expect(await verify(await signToken(key, claimsAt(NOW), { alg, kid: key.kid }))).toBe(false);
    }
  });

  it("refuses an unsigned token with alg none", async () => {
    const { verify } = setup();
    const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "none", kid: key.kid })));
    const body = b64url(new TextEncoder().encode(JSON.stringify(claimsAt(NOW))));
    expect(await verify(`${head}.${body}.`)).toBe(false);
  });

  it("refuses a token with no kid or a kid the certs do not hold", async () => {
    const { verify } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW), { alg: "RS256" }))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW), { alg: "RS256", kid: "kid-unknown" }))).toBe(false);
  });

  it("refuses a token signed by another key under the same kid", async () => {
    const { verify } = setup();
    expect(await verify(await signToken(stranger, claimsAt(NOW)))).toBe(false);
  });

  it("refuses a token whose claims were changed after signing", async () => {
    const { verify } = setup();
    const token = await signToken(key, claimsAt(NOW, { aud: ["someone-else"] }));
    expect(await verify(tamper(token, 1, (claims) => { claims.aud = [AUD]; }))).toBe(false);
  });

  it("refuses a token for another audience", async () => {
    const { verify } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW, { aud: ["someone-else"] })))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW, { aud: [] })))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW, { aud: undefined })))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW, { aud: [`${AUD}x`] })))).toBe(false);
  });

  it("refuses a token from another issuer", async () => {
    const { verify } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW, { iss: "https://evil.cloudflareaccess.com" })))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW, { iss: TEAM })))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW, { iss: undefined })))).toBe(false);
  });

  it("refuses an expired token, a token with no expiry and one that is not valid yet", async () => {
    const { verify, clock } = setup();
    const token = await signToken(key, claimsAt(NOW));
    clock.now = NOW + 301_000;
    expect(await verify(token)).toBe(false);
    clock.now = NOW;
    expect(await verify(await signToken(key, claimsAt(NOW, { exp: undefined })))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW, { exp: "9999999999" })))).toBe(false);
    expect(await verify(await signToken(key, claimsAt(NOW, { nbf: Math.floor(NOW / 1000) + 60 })))).toBe(false);
  });

  it("refuses at the very second a token expires", async () => {
    const { verify, clock } = setup();
    const token = await signToken(key, claimsAt(NOW));
    clock.now = NOW + 299_000;
    expect(await verify(token)).toBe(true);
    clock.now = NOW + 300_000;
    expect(await verify(token)).toBe(false);
  });
});

describe("the team's certs", () => {
  it("refuses everything when the certs address is down or answers junk", async () => {
    for (const mode of ["down", "junk"] as const) {
      const { verify, certs } = setup();
      certs.mode = mode;
      expect(await verify(await signToken(key, claimsAt(NOW)))).toBe(false);
    }
  });

  it("refuses when the certs fetch throws", async () => {
    const verifier = createAccessVerifier({ fetch: async () => { throw new Error("network"); }, now: () => NOW });
    expect(await verifier.verify(await signToken(key, claimsAt(NOW)), CONFIG)).toBe(false);
  });

  it("keeps the last good keys when a later fetch fails", async () => {
    const { verify, certs, clock } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW)))).toBe(true);
    certs.mode = "down";
    clock.now = NOW + 11 * 60_000;
    expect(await verify(await signToken(key, claimsAt(clock.now)))).toBe(true);
  });

  it("keeps the certs for ten minutes, then fetches them again and stops trusting a key Cloudflare removed", async () => {
    const replacement = await makeKey("kid-2");
    const { verify, certs, clock } = setup([key]);
    expect(await verify(await signToken(key, claimsAt(NOW)))).toBe(true);
    certs.keys = [replacement];
    clock.now = NOW + 9 * 60_000;
    expect(await verify(await signToken(key, claimsAt(clock.now)))).toBe(true);
    expect(certs.urls).toHaveLength(1);
    clock.now = NOW + 10 * 60_000 + 1;
    expect(await verify(await signToken(key, claimsAt(clock.now)))).toBe(false);
    expect(certs.urls).toHaveLength(2);
    expect(await verify(await signToken(replacement, claimsAt(clock.now)))).toBe(true);
    expect(certs.urls).toHaveLength(2);
  });

  it("refetches for an unknown kid, but at most once a minute", async () => {
    const rotated = await makeKey("kid-2");
    const { verify, certs, clock } = setup([key]);
    expect(await verify(await signToken(key, claimsAt(NOW)))).toBe(true);
    certs.keys = [key, rotated];
    const token = await signToken(rotated, claimsAt(NOW));
    expect(await verify(token)).toBe(false);
    expect(certs.urls).toHaveLength(1);
    clock.now = NOW + 61_000;
    expect(await verify(await signToken(rotated, claimsAt(clock.now)))).toBe(true);
    expect(certs.urls).toHaveLength(2);
  });

  it("does not call the certs address again and again for a stream of unknown kids", async () => {
    const { verify, certs } = setup();
    for (let i = 0; i < 5; i += 1) await verify(await signToken(key, claimsAt(NOW), { alg: "RS256", kid: `junk-${i}` }));
    expect(certs.urls).toHaveLength(1);
  });
});

describe("the Access settings", () => {
  it("accepts nothing when the settings are missing", async () => {
    const { verify, certs } = setup();
    expect(await verify(await signToken(key, claimsAt(NOW)), null)).toBe(false);
    expect(certs.urls).toHaveLength(0);
  });

  it("reads a team domain and an audience, and nothing else", () => {
    expect(accessConfigOf({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD })).toEqual(CONFIG);
    expect(accessConfigOf({ ACCESS_TEAM_DOMAIN: ` ${TEAM} `, ACCESS_AUD: ` ${AUD} ` })).toEqual(CONFIG);
    expect(accessConfigOf({})).toBeNull();
    expect(accessConfigOf({ ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(accessConfigOf({ ACCESS_AUD: AUD })).toBeNull();
    expect(accessConfigOf({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "  " })).toBeNull();
  });

  it("refuses a team domain that is not a Cloudflare Access address", () => {
    for (const teamDomain of ["evil.example.com", "https://x.cloudflareaccess.com", "x.cloudflareaccess.com/path", "x.cloudflareaccess.com.evil.test", "cloudflareaccess.com"]) {
      expect(accessConfigOf({ ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: AUD })).toBeNull();
    }
  });
});
