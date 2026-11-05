import type { Fetch } from "./api.ts";
import { noteSignInAgain } from "./draft-words.ts";

// Only for walk, report and Get It Fixed calls: there a 401 means a moved walk whose session has run out.
export const notingSignInAgain =
  (send: Fetch): Fetch =>
  async (request) => {
    const reply = await send(request);
    if (reply.status === 401) noteSignInAgain();
    return reply;
  };
