import { DELETE_EVERYTHING_PATH, DeleteEverythingResponse, VISITOR_HEADER } from "@emberwalk/shared";
import { ask, bySchema } from "./api.ts";
import type { Answer, Fetch } from "./api.ts";

export type EraseApi = { everything(): Promise<Answer<DeleteEverythingResponse>> };

export const eraseApi = (base: string, send: Fetch, visitorId: () => string): EraseApi => ({
  everything: () => {
    const visitor = visitorId();
    return ask(
      send,
      new Request(new URL(DELETE_EVERYTHING_PATH, base), {
        method: "POST",
        headers: { "content-type": "application/json", [VISITOR_HEADER]: visitor },
        body: JSON.stringify({ visitorId: visitor }),
      }),
      bySchema(DeleteEverythingResponse),
    );
  },
});
