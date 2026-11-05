type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

const RANGE = /^bytes=(\d*)-(\d*)$/;

const TYPES: Record<string, string> = { m3u8: "application/vnd.apple.mpegurl", m4s: "video/iso.segment" };

export const partOf = (header: string, size: number): { start: number; end: number } | null => {
  const match = RANGE.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start > end || start >= size ? null : { start, end };
};

const slice = (body: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let at = 0;
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      const from = Math.max(0, start - at);
      const to = Math.min(value.length, end + 1 - at);
      at += value.length;
      if (from < to) controller.enqueue(value.subarray(from, to));
      if (at > end) {
        void reader.cancel();
        controller.close();
      }
    },
    cancel: () => reader.cancel(),
  });
};

export const answer = async (request: Request, env: Env): Promise<Response> => {
  const tag = request.headers.get("if-none-match");
  const whole = await env.ASSETS.fetch(new Request(request.url, { method: "GET", headers: tag === null ? {} : { "if-none-match": tag } }));
  if (!whole.ok && whole.status !== 304) return whole;
  const headers = new Headers(whole.headers);
  headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "https://emberwalk.app");
  headers.set("vary", "origin");
  const type = TYPES[new URL(request.url).pathname.split(".").pop() ?? ""];
  if (type !== undefined) headers.set("content-type", type);
  if (whole.status === 304) return new Response(null, { status: 304, headers });
  const range = request.headers.get("range");
  const length = headers.get("content-length");
  if (range === null || whole.body === null) return new Response(request.method === "HEAD" ? null : whole.body, { status: 200, headers });
  const bytes = length === null ? await whole.arrayBuffer() : null;
  const size = bytes === null ? Number(length) : bytes.byteLength;
  const part = partOf(range, size);
  if (part === null) {
    headers.set("content-range", `bytes */${size}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${part.start}-${part.end}/${size}`);
  headers.set("content-length", String(part.end - part.start + 1));
  if (request.method === "HEAD") return new Response(null, { status: 206, headers });
  return new Response(bytes === null ? slice(whole.body, part.start, part.end) : bytes.slice(part.start, part.end + 1), { status: 206, headers });
};

export default { fetch: answer };
