import { shortDay } from "./report-words.ts";
import { shortDayEs } from "./report-words-es.ts";

const SEND_URL = "https://api.resend.com/emails";
const SENDER = "EmberWalk <hello@emberwalk.app>";
const TERMS = "https://emberwalk.app/terms";
const REFUNDS = "https://emberwalk.app/refunds";

export type RenewalWords = {
  subject: (day: string) => string;
  lines: (day: string, amount: string, link: string) => string[];
};

export const renewalMailEn: RenewalWords = {
  subject: (day) => `Your EmberWalk plan renews on ${day}`,
  lines: (day, amount, link) => [
    `Your EmberWalk plan renews automatically on ${day} unless you cancel it first.`,
    `It renews for one more year, once a year, at ${amount}, charged to the payment method you used.`,
    `To cancel, open this link and enter the email on your plan: ${link}`,
    "Cancelling stops the next renewal. You keep your walks until the end of the year you paid for.",
    `The terms are at ${TERMS} and the refund and cancellation policy is at ${REFUNDS}.`,
    "Questions: hello@emberwalk.app",
  ],
};

export const renewalMailEs: RenewalWords = {
  subject: (day) => `Su plan de EmberWalk se renueva el ${day}`,
  lines: (day, amount, link) => [
    `Su plan de EmberWalk se renueva automáticamente el ${day} a menos que usted lo cancele antes.`,
    `Se renueva por un año más, una vez al año, por ${amount}, y se carga al método de pago que usted usó.`,
    `Para cancelar, abra este enlace e ingrese el correo de su plan: ${link}`,
    "Cancelar detiene la próxima renovación. Usted conserva sus recorridos hasta el final del año que pagó.",
    `Los términos están en ${TERMS} y la política de reembolsos y cancelación está en ${REFUNDS}.`,
    "Preguntas: hello@emberwalk.app",
  ],
};

export type RenewalMail = {
  apiKey: string | undefined;
  portalLoginUrl: string | undefined;
  footer: string | undefined;
  to: string;
  language: "en" | "es";
  renewsOn: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  fetch: typeof fetch;
};

export type RenewalResult = { ok: true } | { ok: false; code: "not_set_up" | "bad_address" | "key_rejected" | "refused" | "down" | "unreachable" };

const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

const amountOf = (cents: number, currency: string): string => {
  const figure = (cents / 100).toFixed(2);
  return currency.toLowerCase() === "usd" ? `$${figure}` : `${figure} ${currency.toUpperCase()}`;
};

const httpsLink = (value: string | undefined): string | null => {
  if (value === undefined || value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

export const sendRenewalMail = async (mail: RenewalMail): Promise<RenewalResult> => {
  const link = httpsLink(mail.portalLoginUrl);
  if (mail.apiKey === undefined || mail.apiKey === "" || mail.footer === undefined || mail.footer === "" || link === null) return { ok: false, code: "not_set_up" };
  if (!ADDRESS.test(mail.to)) return { ok: false, code: "bad_address" };
  const words = mail.language === "es" ? renewalMailEs : renewalMailEn;
  const day = mail.language === "es" ? shortDayEs(mail.renewsOn) : shortDay(mail.renewsOn);
  const text = [...words.lines(day, amountOf(mail.amountCents, mail.currency), link), "", mail.footer].join("\n");
  let response: Response;
  try {
    response = await mail.fetch(SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${mail.apiKey}`, "content-type": "application/json", "idempotency-key": mail.idempotencyKey },
      body: JSON.stringify({ from: SENDER, to: [mail.to], subject: words.subject(day), text }),
    });
  } catch {
    return { ok: false, code: "unreachable" };
  }
  if (response.ok) return { ok: true };
  if (response.status === 401 || response.status === 403) return { ok: false, code: "key_rejected" };
  return { ok: false, code: response.status >= 500 ? "down" : "refused" };
};
