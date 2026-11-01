const CERTS_TTL_MS = 10 * 60_000;
const REFETCH_MS = 60_000;
const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export type AccessConfig = { teamDomain: string; audience: string };
export type AccessEnv = { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };
export type AccessDeps = { fetch: (url: string) => Promise<Response>; now: () => number };

export const accessConfigOf = (env: AccessEnv): AccessConfig | null => {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase() ?? "";
  const audience = env.ACCESS_AUD?.trim() ?? "";
  return TEAM_DOMAIN.test(teamDomain) && audience !== "" ? { teamDomain, audience } : null;
};

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

const jsonOf = (text: string): Record<string, unknown> | null => {
  const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(text)));
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
};

const importKeys = async (body: unknown): Promise<Map<string, CryptoKey>> => {
  const keys = new Map<string, CryptoKey>();
  const list = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) return keys;
  for (const jwk of list as (JsonWebKey & { kid?: unknown })[]) {
    if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
    try {
      keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, RS256, false, ["verify"]));
    } catch {
      continue;
    }
  }
  return keys;
};

export const createAccessVerifier = (deps: AccessDeps) => {
  const cache = new Map<string, { keys: Map<string, CryptoKey>; at: number }>();

  const load = async (teamDomain: string): Promise<Map<string, CryptoKey> | null> => {
    try {
      const response = await deps.fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
      return response.ok ? await importKeys(await response.json()) : null;
    } catch {
      return null;
    }
  };

  const keyFor = async (teamDomain: string, kid: string): Promise<CryptoKey | null> => {
    const t = deps.now();
    const known = cache.get(teamDomain);
    const age = known === undefined ? Infinity : t - known.at;
    const found = age < CERTS_TTL_MS ? known?.keys.get(kid) : undefined;
    if (found !== undefined) return found;
    if (age < REFETCH_MS) return null;
    const keys = (await load(teamDomain)) ?? known?.keys ?? new Map<string, CryptoKey>();
    cache.set(teamDomain, { keys, at: t });
    return keys.get(kid) ?? null;
  };

  const verify = async (token: string | null, config: AccessConfig | null): Promise<boolean> => {
    if (config === null || token === null) return false;
    try {
      const parts = token.split(".");
      const [head, body, signature] = parts;
      if (parts.length !== 3 || !head || !body || !signature) return false;
      const header = jsonOf(head);
      if (header === null || header.alg !== "RS256" || typeof header.kid !== "string") return false;
      const key = await keyFor(config.teamDomain, header.kid);
      if (key === null) return false;
      const signed = await crypto.subtle.verify(RS256.name, key, fromBase64Url(signature), new TextEncoder().encode(`${head}.${body}`));
      const claims = signed ? jsonOf(body) : null;
      if (claims === null) return false;
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const { exp, nbf } = claims;
      const now = deps.now();
      return (
        claims.iss === `https://${config.teamDomain}` &&
        audience.includes(config.audience) &&
        typeof exp === "number" &&
        exp * 1000 > now &&
        (nbf === undefined || (typeof nbf === "number" && nbf * 1000 <= now))
      );
    } catch {
      return false;
    }
  };

  return { verify };
};
