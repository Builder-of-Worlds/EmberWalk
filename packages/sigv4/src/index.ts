const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (text: string): Promise<string> => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

const hmac = async (key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> => {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(text));
};

const encode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const encodePath = (path: string): string => path.split("/").map(encode).join("/");

export type Presign = {
  method: "GET" | "PUT" | "DELETE";
  host: string;
  path: string;
  query?: Record<string, string>;
  signedHeaders?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now: Date;
  expiresSeconds: number;
};

const stamp = (now: Date): string => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export const presign = async (input: Presign): Promise<string> => {
  const amzDate = stamp(input.now);
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const headers: Record<string, string> = { host: input.host };
  for (const [name, value] of Object.entries(input.signedHeaders ?? {})) {
    headers[name.toLowerCase()] = value.trim();
  }
  const headerNames = Object.keys(headers).sort();

  const query: Record<string, string> = {
    ...input.query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": headerNames.join(";"),
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k] as string)}`)
    .join("&");

  const canonicalRequest = [
    input.method,
    encodePath(input.path),
    canonicalQuery,
    headerNames.map((n) => `${n}:${headers[n]}\n`).join(""),
    headerNames.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  let key: ArrayBuffer = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), day);
  for (const part of [input.region, input.service, "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));

  return `https://${input.host}${encodePath(input.path)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
};
