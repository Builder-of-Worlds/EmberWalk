import { RecheckErrorBody, RecheckLinkResponse, RecheckResponse, VISITOR_HEADER } from "@emberwalk/shared";
import type { Recheck, RecheckLinkRequest, RecheckRouteCode } from "@emberwalk/shared";
import type { Fetch } from "./api.ts";

export type RecheckCode = RecheckRouteCode | "offline";

export type RecheckAnswer = { recheck: Recheck; code?: undefined } | { recheck?: undefined; code: RecheckCode };

export type RecheckApi = { send(findingId: string, photo: Blob): Promise<RecheckAnswer> };

type Step<T> = { value: T } | { code: RecheckCode };

const call = async <T>(send: Fetch, request: Request, read: (body: unknown) => T | null): Promise<Step<T>> => {
  let response: Response;
  let body: unknown;
  try {
    response = await send(request);
    body = await response.json().catch(() => null);
  } catch {
    return { code: "offline" };
  }
  if (response.ok) {
    const value = read(body);
    return value === null ? { code: "server_error" } : { value };
  }
  const error = RecheckErrorBody.safeParse(body);
  return { code: error.success ? error.data.error.code : "server_error" };
};

const parsed =
  <T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }) =>
  (body: unknown): T | null => {
    const result = schema.safeParse(body);
    return result.success ? result.data : null;
  };

export const offlineRechecks: RecheckApi = { send: async () => ({ code: "offline" }) };

export const recheckApi = (base: string, send: Fetch, visitorId: () => string): RecheckApi => {
  const post = (path: string, body: unknown) =>
    new Request(new URL(path, base), {
      method: "POST",
      headers: { "content-type": "application/json", [VISITOR_HEADER]: visitorId() },
      body: JSON.stringify(body),
    });
  return {
    send: async (findingId, photo) => {
      const ask: RecheckLinkRequest = { findingId, contentType: photo.type as RecheckLinkRequest["contentType"], bytes: photo.size };
      const link = await call(send, post("/api/rechecks", ask), parsed(RecheckLinkResponse));
      if ("code" in link) return { code: link.code };
      try {
        const put = await send(new Request(link.value.url, { method: "PUT", headers: link.value.headers, body: photo }));
        if (!put.ok) return { code: "server_error" };
      } catch {
        return { code: "offline" };
      }
      const judged = await call(send, post(`/api/rechecks/${encodeURIComponent(link.value.recheckId)}`, { findingId }), parsed(RecheckResponse));
      return "code" in judged ? { code: judged.code } : { recheck: judged.value.recheck };
    },
  };
};
