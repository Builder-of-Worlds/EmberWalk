import type { Message } from "./types";

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

export function finishEmail(message: Message, postalFooter: string | undefined): string {
  const footer = postalFooter?.trim();
  if (!footer) throw new Error("no postal address is set, so no email is sent");
  return [
    message.body,
    "",
    `To be taken off the list, use this link, or reply to this email and say so: ${message.unsubscribeUrl}`,
    "",
    footer,
  ].join("\n");
}
