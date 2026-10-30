export type Render = { sha256: string; bytes: number };

export const parseRenders = (value: string | undefined): Render[] =>
  (value ?? "")
    .split(",")
    .map((entry) => /^([0-9a-f]{64}):([1-9][0-9]*)$/.exec(entry.trim()))
    .flatMap((m) => (m === null ? [] : [{ sha256: m[1] as string, bytes: Number(m[2]) }]));

const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const renderCheck =
  (bucket: R2Bucket, renders: Render[]) =>
  async (key: string): Promise<boolean> => {
    const head = await bucket.head(key);
    if (head === null || !renders.some((r) => r.bytes === head.size)) return false;
    const object = await bucket.get(key);
    if (object === null) return false;
    const digest = new crypto.DigestStream("SHA-256");
    await object.body.pipeTo(digest);
    const sha256 = hex(await digest.digest);
    return renders.some((r) => r.sha256 === sha256 && r.bytes === head.size);
  };
