import { describe, expect, it } from "vitest";
import { presign } from "../src/sigv4.ts";
import type { Presign } from "../src/sigv4.ts";

const exampleKeyId = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

const awsExample: Presign = {
  method: "GET",
  host: "examplebucket.s3.amazonaws.com",
  path: "/test.txt",
  accessKeyId: exampleKeyId,
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "s3",
  now: new Date("2013-05-24T00:00:00Z"),
  expiresSeconds: 86400,
};

const signatureOf = (url: string): string => new URL(url).searchParams.get("X-Amz-Signature") ?? "";

describe("presign", () => {
  it("matches the published AWS example signature", async () => {
    const url = await presign(awsExample);
    expect(signatureOf(url)).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?")).toBe(true);
  });

  it("states the credential scope, date, expiry and signed headers", async () => {
    const url = new URL(await presign(awsExample));
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe(`${exampleKeyId}/20130524/us-east-1/s3/aws4_request`);
    expect(url.searchParams.get("X-Amz-Date")).toBe("20130524T000000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("86400");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("changes the signature when anything signed changes", async () => {
    const base = signatureOf(await presign(awsExample));
    const variants: Partial<Presign>[] = [
      { secretAccessKey: "other" },
      { method: "PUT" },
      { path: "/other.txt" },
      { expiresSeconds: 900 },
      { now: new Date("2013-05-24T00:00:01Z") },
      { query: { partNumber: "1" } },
      { signedHeaders: { "Content-Length": "5" } },
      { host: "other.s3.amazonaws.com" },
    ];
    const seen = new Set([base]);
    for (const variant of variants) seen.add(signatureOf(await presign({ ...awsExample, ...variant })));
    expect(seen.size).toBe(variants.length + 1);
  });

  it("signs extra headers by lower case name, sorted, with the host", async () => {
    const url = new URL(await presign({ ...awsExample, signedHeaders: { "Content-Length": " 5 " } }));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
    const same = await presign({ ...awsExample, signedHeaders: { "content-length": "5" } });
    expect(signatureOf(same)).toBe(url.searchParams.get("X-Amz-Signature"));
  });

  it("encodes keys and query values the way S3 expects", async () => {
    const url = await presign({ ...awsExample, path: "/b/originals/a b/it's (1).mp4", query: { uploadId: "a+b/c=" } });
    expect(url).toContain("/b/originals/a%20b/it%27s%20%281%29.mp4?");
    expect(url).toContain("uploadId=a%2Bb%2Fc%3D");
  });
});
