import { launchDateShown } from "./launch-date";
import type { Message } from "./types";

export function welcomeMessage(to: string, unsubscribeUrl: string, env: object): Message {
  const launchLine = launchDateShown(env)
    ? "EmberWalk launches Nov. 4th, 2026. We'll email you when it does."
    : "We'll email you when EmberWalk launches.";
  return {
    to,
    unsubscribeUrl,
    subject: "You're on the list",
    body: [
      "Thank you for signing up. You're on the list for EmberWalk.",
      "",
      launchLine,
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

export function welcomeMessageEs(to: string, unsubscribeUrl: string, env: object): Message {
  const launchLine = launchDateShown(env)
    ? "EmberWalk sale el 4 de noviembre de 2026. Le enviaremos un correo cuando salga."
    : "Le enviaremos un correo cuando EmberWalk salga.";
  return {
    to,
    unsubscribeUrl,
    subject: "Ya está en la lista",
    body: [
      "Gracias por inscribirse. Ya está en la lista de EmberWalk.",
      "",
      launchLine,
      "",
      "Le enviaremos correos sobre el lanzamiento y las novedades de EmberWalk.",
      "",
      "Preguntas: hello@emberwalk.app",
    ].join("\n"),
  };
}

export function finishEmailEs(message: Message, postalFooter: string | undefined): string {
  const footer = postalFooter?.trim();
  if (!footer) throw new Error("no postal address is set, so no email is sent");
  return [
    message.body,
    "",
    `Para salir de la lista, use este enlace, o responda a este correo y avísenos: ${message.unsubscribeUrl}`,
    "",
    footer,
  ].join("\n");
}
