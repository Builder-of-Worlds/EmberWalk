import { TOKEN_PATTERN } from "./sign-in-token.ts";

const SEND_URL = "https://api.resend.com/emails";
const SENDER = "EmberWalk <hello@emberwalk.app>";
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

// Draft words: they wait for the owner's approval.
export const draftSignInMail = {
  subject: "Your EmberWalk sign in code",
  codeLines: ["Your EmberWalk sign in code:", "", "{code}", "", "Type it in the EmberWalk app. Or tap this link on the same phone:", ""],
  lines: ["Tap this link to sign in to EmberWalk. It works once and ends in 15 minutes.", "", "{link}", "", "If you did not ask for it, you can ignore this mail."],
};

export const draftSignInMailEs = {
  subject: "Su código para iniciar sesión en EmberWalk",
  codeLines: ["Su código para iniciar sesión en EmberWalk:", "", "{code}", "", "Escríbalo en la aplicación EmberWalk. O toque este enlace en el mismo teléfono:", ""],
  lines: ["Toque este enlace para iniciar sesión en EmberWalk. Funciona una sola vez y vence en 15 minutos.", "", "{link}", "", "Si usted no lo pidió, puede ignorar este correo."],
};

export const draftChangeMail = {
  subject: "Your EmberWalk email change code",
  lines: ["Your code to move your EmberWalk account to this email:", "", "{code}", "", "Type it in the EmberWalk app. It ends in 15 minutes.", "", "If you did not ask for it, you can ignore this mail."],
};

export const draftChangeMailEs = {
  subject: "Su código para cambiar el correo de EmberWalk",
  lines: ["Su código para pasar su cuenta de EmberWalk a este correo:", "", "{code}", "", "Escríbalo en la aplicación EmberWalk. Vence en 15 minutos.", "", "Si usted no lo pidió, puede ignorar este correo."],
};

const CODE = /^\d{6}$/;

export type MailResult = { ok: true } | { ok: false; code: "not_set_up" | "bad_address" | "bad_token" | "refused" | "down" | "unreachable" };

export type SignInMail = {
  apiKey: string | undefined;
  appOrigin: string | undefined;
  to: string;
  token: string;
  code?: string;
  purpose?: "sign_in" | "change_email";
  language?: "en" | "es";
  fetch: typeof fetch;
};

const originOf = (appOrigin: string | undefined): string | null => {
  if (appOrigin === undefined || appOrigin === "") return null;
  try {
    const url = new URL(appOrigin);
    const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return url.protocol === "https:" || local ? url.origin : null;
  } catch {
    return null;
  }
};

export const sendSignInMail = async (mail: SignInMail): Promise<MailResult> => {
  const origin = originOf(mail.appOrigin);
  if (mail.apiKey === undefined || mail.apiKey === "" || origin === null) return { ok: false, code: "not_set_up" };
  if (!ADDRESS.test(mail.to)) return { ok: false, code: "bad_address" };
  if (!TOKEN_PATTERN.test(mail.token)) return { ok: false, code: "bad_token" };
  if (mail.code !== undefined && !CODE.test(mail.code)) return { ok: false, code: "bad_token" };
  const link = `${origin}/#/sign-in/${mail.token}`;
  const change = mail.purpose === "change_email";
  if (change && mail.code === undefined) return { ok: false, code: "bad_token" };
  const words = mail.language === "es" ? draftSignInMailEs : draftSignInMail;
  const changeWords = mail.language === "es" ? draftChangeMailEs : draftChangeMail;
  const shown = mail.code === undefined ? "" : `${mail.code.slice(0, 3)} ${mail.code.slice(3)}`;
  const withCode = (lines: string[]) => lines.map((line) => line.replace("{code}", shown));
  const lines = change ? withCode(changeWords.lines) : mail.code === undefined ? words.lines : [...withCode(words.codeLines), ...words.lines.slice(2)];
  let response: Response;
  try {
    response = await mail.fetch(SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${mail.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: SENDER,
        to: [mail.to],
        subject: change ? changeWords.subject : words.subject,
        text: lines.join("\n").replace("{link}", () => link),
      }),
    });
  } catch {
    return { ok: false, code: "unreachable" };
  }
  if (response.ok) return { ok: true };
  return { ok: false, code: response.status >= 500 ? "down" : "refused" };
};
