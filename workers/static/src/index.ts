import { handle } from "./handler";
import { createResendMailer } from "./resend";
import type { Env } from "./types";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const mailer = env.RESEND_API_KEY ? createResendMailer(env.RESEND_API_KEY, env.POSTAL_FOOTER, fetch) : null;
    return handle(request, env, { fetchImpl: fetch, mailer });
  },
};
