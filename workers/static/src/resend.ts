import { finishEmail } from "./email-copy";
import type { Mailer } from "./types";

const SEND_URL = "https://api.resend.com/emails";
const SENDER = "hello@emberwalk.app";

export function createResendMailer(apiKey: string, fetchImpl: typeof fetch): Mailer {
  return {
    async send(message) {
      const response = await fetchImpl(SEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: `EmberWalk <${SENDER}>`,
          reply_to: SENDER,
          to: [message.to],
          subject: message.subject,
          text: finishEmail(message),
          headers: {
            "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
      if (!response.ok) throw new Error(`Resend answered ${response.status}`);
    },
  };
}
