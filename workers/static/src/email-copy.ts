import type { Message } from "./types";

export const POSTAL_FOOTER = "EmberWalk, Deacon Roswell, 732 S 6th Street #5709, Las Vegas, NV 89101";

export function welcomeMessage(to: string, unsubscribeUrl: string): Message {
  return {
    to,
    unsubscribeUrl,
    subject: "You're on the list",
    body: [
      "Thank you for signing up. You're on the list for EmberWalk.",
      "",
      "EmberWalk launches Nov. 4th, 2026. We'll email you when it does.",
      "",
      "We'll email you about EmberWalk's launch and updates.",
      "",
      "Questions: hello@emberwalk.app",
    ].join("\n"),
  };
}

export function finishEmail(message: Message): string {
  return [
    message.body,
    "",
    `To be taken off the list, use this link, or reply to this email and say so: ${message.unsubscribeUrl}`,
    "",
    POSTAL_FOOTER,
  ].join("\n");
}
