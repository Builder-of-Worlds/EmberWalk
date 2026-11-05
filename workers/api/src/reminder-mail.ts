import type { ReminderKind } from "@emberwalk/db";
import { shortDay } from "./report-words.ts";
import { shortDayEs } from "./report-words-es.ts";

const SEND_URL = "https://api.resend.com/emails";
const SENDER = "EmberWalk <hello@emberwalk.app>";
const SITE = "https://emberwalk.app";
const LOGO = `${SITE}/brand/lockup-dark.png`;
const PHOTO = `${SITE}/landing/synthetic-ridge-960.webp`;
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

type Shown = { dueDay: string; walkDay: string; done: number; total: number };

type KindWords = { subject: string | ((due: string) => string); preview: string; eyebrow: string; heading: string; body: (shown: Shown) => string[]; box?: (shown: Shown) => [string, string][]; button: string; under: string };

type Words = { day: (iso: string) => string; yearly: KindWords & { subject: (due: string) => string }; after_walk: KindWords & { subject: string }; why: (email: string) => string; off: string };

// Draft words: the owner approved this wording; change it only with the owner.
export const reminderWords: Record<"en" | "es", Words> = {
  en: {
    day: shortDay,
    yearly: {
      subject: (due) => `Your yearly EmberWalk is due ${due.replace(/, \d{4}$/, "")}`,
      preview: "Fire season is coming. Walk around your house before it does.",
      eyebrow: "Your yearly walk",
      heading: "Walk your house before fire season",
      body: (s) => [`Hi. Your next EmberWalk is due ${s.dueDay}.`, "A year of growth can bring brush, leaves and branches back close to your walls. One walk around your house shows what needs clearing now, while there is time."],
      box: (s) => [["Your last walk:", s.walkDay], ["Fixes marked done:", `${s.done} of ${s.total}`]],
      button: "Walk My House",
      under: "It takes about five minutes. Hold your phone up and walk once around the house.",
    },
    after_walk: {
      subject: "Your first fixes are done. Record your after walk.",
      preview: "One more walk shows the work you did.",
      eyebrow: "Nice work",
      heading: "Your first fixes are done",
      body: () => ["You marked your first three fixes done. Now walk around your house once more.", "EmberWalk checks the cleared spots and keeps a dated before and after of your work in your report."],
      button: "Record My After Walk",
      under: "Same as before: about five minutes, phone held up, once around the house.",
    },
    why: (email) => `You get this because your EmberWalk account uses ${email}.`,
    off: "Turn off reminders",
  },
  es: {
    day: shortDayEs,
    yearly: {
      subject: (due) => `Su EmberWalk anual vence el ${due.replace(/ de \d{4}$/, "")}`,
      preview: "Se acerca la temporada de incendios. Recorra su casa antes.",
      eyebrow: "Su recorrido anual",
      heading: "Recorra su casa antes de la temporada de incendios",
      body: (s) => [`Hola. Su próximo EmberWalk vence el ${s.dueDay}.`, "En un año pueden volver a crecer maleza, hojas y ramas cerca de sus paredes. Un recorrido alrededor de su casa muestra lo que hay que limpiar ahora, mientras hay tiempo."],
      box: (s) => [["Su último recorrido:", s.walkDay], ["Arreglos marcados como hechos:", `${s.done} de ${s.total}`]],
      button: "Recorrer mi casa",
      under: "Toma unos cinco minutos. Sostenga el teléfono y dé una vuelta alrededor de la casa.",
    },
    after_walk: {
      subject: "Sus primeros arreglos están hechos. Grabe su recorrido de después.",
      preview: "Un recorrido más muestra el trabajo que hizo.",
      eyebrow: "Buen trabajo",
      heading: "Sus primeros arreglos están hechos",
      body: () => ["Marcó sus tres primeros arreglos como hechos. Ahora recorra su casa una vez más.", "EmberWalk revisa los lugares despejados y guarda un antes y después con fecha de su trabajo en su informe."],
      button: "Grabar mi recorrido de después",
      under: "Igual que antes: unos cinco minutos, con el teléfono en alto, una vuelta alrededor de la casa.",
    },
    why: (email) => `Recibe esto porque su cuenta de EmberWalk usa ${email}.`,
    off: "Desactivar recordatorios",
  },
};

export type ReminderMail = {
  apiKey: string | undefined;
  footer: string | undefined;
  appOrigin: string;
  to: string;
  language: "en" | "es";
  kind: ReminderKind;
  dueDay: string | null;
  walkDay: string;
  done: number;
  total: number;
  offUrl: string;
  idempotencyKey: string;
  fetch: typeof fetch;
};

export type ReminderResult = { ok: true } | { ok: false; code: "not_set_up" | "bad_address" | "refused" | "busy" | "down" | "unreachable" };

const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = "'Atkinson Hyperlegible',Verdana,Arial,sans-serif";

export const reminderMailOf = (mail: Omit<ReminderMail, "apiKey" | "idempotencyKey" | "fetch"> & { footer: string }): { subject: string; html: string; text: string } => {
  const all = reminderWords[mail.language];
  const words = all[mail.kind];
  const shown: Shown = { dueDay: mail.dueDay === null ? "" : all.day(mail.dueDay), walkDay: all.day(mail.walkDay), done: mail.done, total: mail.total };
  const subject = typeof words.subject === "string" ? words.subject : words.subject(shown.dueDay);
  const walkUrl = `${mail.appOrigin}/#/record`;
  const box = words.box?.(shown) ?? [];
  const html = `<!doctype html><html lang="${mail.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#ece6d4;"><div style="display:none;max-height:0;overflow:hidden;">${esc(words.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ece6d4;"><tr><td align="center" style="padding:16px 12px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f7f3e6;border:2px solid #3d5a40;border-radius:16px;overflow:hidden;font-family:${FONT};color:#1a271e;">
<tr><td style="background:#1a271e url('${PHOTO}') center 35%/cover no-repeat;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,rgba(26,39,30,.35),rgba(26,39,30,.85));"><tr><td align="center" style="padding:28px 24px 30px;"><img src="${LOGO}" width="200" alt="EmberWalk" style="display:block;width:200px;height:auto;border:0;"></td></tr></table></td></tr>
<tr><td align="center" style="padding:30px 28px 6px;"><p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#3d5a40;">${esc(words.eyebrow)}</p><h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;">${esc(words.heading)}</h1></td></tr>
<tr><td style="padding:16px 28px 0;font-size:17px;line-height:1.55;">${words.body(shown).map((p) => `<p style="margin:0 0 14px;">${esc(p)}</p>`).join("")}</td></tr>
${box.length === 0 ? "" : `<tr><td style="padding:4px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ece6d4;border-radius:12px;"><tr><td style="padding:14px 16px;font-size:15px;line-height:1.5;">${box.map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`).join("<br>")}</td></tr></table></td></tr>`}
<tr><td align="center" style="padding:24px 28px 8px;"><a href="${esc(walkUrl)}" style="display:inline-block;background:#3d5a40;color:#f7f3e6;font-size:18px;font-weight:700;text-decoration:none;padding:15px 34px;border-radius:12px;">${esc(words.button)}</a></td></tr>
<tr><td align="center" style="padding:6px 28px 28px;font-size:15px;line-height:1.5;color:#3d5a40;">${esc(words.under)}</td></tr>
<tr><td align="center" style="background:#22342a;padding:20px 28px;font-size:13px;line-height:1.6;color:#d9d3c0;">${esc(all.why(mail.to))}<br><a href="${esc(mail.offUrl)}" style="color:#f5c24c;">${esc(all.off)}</a> &nbsp;&middot;&nbsp; <a href="${SITE}" style="color:#f5c24c;">emberwalk.app</a><br>${esc(mail.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [words.heading, "", ...words.body(shown).flatMap((p) => [p, ""]), ...box.map(([k, v]) => `${k} ${v}`), ...(box.length === 0 ? [] : [""]), `${words.button}: ${walkUrl}`, words.under, "", all.why(mail.to), `${all.off}: ${mail.offUrl}`, mail.footer].join("\n");
  return { subject, html, text };
};

export const sendReminderMail = async (mail: ReminderMail): Promise<ReminderResult> => {
  if (mail.apiKey === undefined || mail.apiKey === "" || mail.footer === undefined || mail.footer === "") return { ok: false, code: "not_set_up" };
  if (!ADDRESS.test(mail.to)) return { ok: false, code: "bad_address" };
  const { subject, html, text } = reminderMailOf({ ...mail, footer: mail.footer });
  let response: Response;
  try {
    response = await mail.fetch(SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${mail.apiKey}`, "content-type": "application/json", "idempotency-key": mail.idempotencyKey },
      body: JSON.stringify({ from: SENDER, to: [mail.to], subject, html, text, headers: { "List-Unsubscribe": `<${mail.offUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
    });
  } catch {
    return { ok: false, code: "unreachable" };
  }
  if (response.ok) return { ok: true };
  return { ok: false, code: response.status >= 500 ? "down" : response.status === 429 ? "busy" : "refused" };
};
