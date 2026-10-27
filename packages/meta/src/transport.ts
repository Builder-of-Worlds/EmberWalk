import { MetaHttpError } from "./errors.ts";
import type { Json } from "./fingerprint.ts";

export type HttpRequest =
  | { method: "POST"; path: string; json: Json }
  | { method: "POST"; path: string; form: FormData }
  | { method: "DELETE" | "GET"; path: string };

export type HttpResponse = { status: number; retryAfter: string | null; text: string };

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

export type FetchTransportOptions = { baseUrl: string; apiKey: string; fetch?: typeof fetch };

export function fetchTransport({ baseUrl, apiKey, fetch: doFetch = fetch }: FetchTransportOptions): Transport {
  if (apiKey.trim() === "") throw new TypeError("the Meta API key is empty");
  const root = baseUrl.replace(/\/+$/, "");
  return async (req) => {
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
    let body: string | FormData | undefined;
    if ("json" in req) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.json);
    } else if ("form" in req) {
      body = req.form;
    }
    const res = await doFetch(`${root}${req.path}`, { method: req.method, headers, ...(body === undefined ? {} : { body }) });
    return { status: res.status, retryAfter: res.headers.get("retry-after"), text: await res.text() };
  };
}

export function okJson(res: HttpResponse): unknown {
  if (res.status < 200 || res.status > 299) {
    const after = res.retryAfter === null ? null : Number(res.retryAfter);
    throw new MetaHttpError(res.status, res.text.slice(0, 2000), after !== null && Number.isFinite(after) ? after : null);
  }
  return res.text === "" ? null : (JSON.parse(res.text) as unknown);
}
