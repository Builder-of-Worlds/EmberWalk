import { DELETE_EVERYTHING_PATH, DeleteEverythingResponse, VISITOR_HEADER } from "@emberwalk/shared";
import { ask } from "./api.ts";
import type { Answer, Fetch } from "./api.ts";

export const SIGN_IN_FIRST = "sign_in_first";

export type Erased = DeleteEverythingResponse & { accountKept?: true };

const readErased = (body: unknown): Erased | null => {
  const { accountKept, ...counts } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const parsed = DeleteEverythingResponse.safeParse(counts);
  if (!parsed.success) return null;
  return accountKept === true ? { ...parsed.data, accountKept: true } : parsed.data;
};

export type EraseApi = { everything(): Promise<Answer<Erased> | { value?: undefined; code: typeof SIGN_IN_FIRST }> };

export const eraseApi = (base: string, send: Fetch, visitorId: () => string): EraseApi => ({
  everything: async () => {
    const visitor = visitorId();
    let refused = false;
    const noting: Fetch = async (request) => {
      const reply = await send(request);
      refused = reply.status === 401;
      return reply;
    };
    const answer = await ask(
      noting,
      new Request(new URL(DELETE_EVERYTHING_PATH, base), {
        method: "POST",
        headers: { "content-type": "application/json", [VISITOR_HEADER]: visitor },
        body: JSON.stringify({ visitorId: visitor }),
      }),
      readErased,
    );
    return refused ? { code: SIGN_IN_FIRST } : answer;
  },
});
