export const TEAM = "emberwalk-test.cloudflareaccess.com";
export const AUD = "aud-tag-for-tests";

export type TestKey = { kid: string; privateKey: CryptoKey; publicJwk: Record<string, unknown> };

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export const makeKey = async (kid: string): Promise<TestKey> => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, publicJwk: { ...publicJwk, kid, alg: "RS256", use: "sig" } };
};

export const claimsAt = (nowMs: number, over: Record<string, unknown> = {}): Record<string, unknown> => {
  const now = Math.floor(nowMs / 1000);
  return { iss: `https://${TEAM}`, aud: [AUD], iat: now, nbf: now, exp: now + 300, sub: "operator", ...over };
};

export const signToken = async (key: TestKey, claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: key.kid, typ: "JWT" }): Promise<string> => {
  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, utf8(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
};

export type CertsEndpoint = { urls: string[]; fetch: (url: string | URL | Request) => Promise<Response>; keys: TestKey[]; mode: "ok" | "down" | "junk" };

export const certsEndpoint = (keys: TestKey[]): CertsEndpoint => {
  const endpoint: CertsEndpoint = {
    urls: [],
    keys,
    mode: "ok",
    fetch: async (url) => {
      endpoint.urls.push(String(url instanceof Request ? url.url : url));
      if (endpoint.mode === "down") return new Response("down", { status: 503 });
      if (endpoint.mode === "junk") return new Response("<html>not json</html>", { status: 200 });
      return Response.json({ keys: endpoint.keys.map((k) => k.publicJwk), public_cert: { kid: "x", cert: "x" }, public_certs: [] });
    },
  };
  return endpoint;
};
