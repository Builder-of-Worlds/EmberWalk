import { remindersOff, remindersOn, setReminders } from "@emberwalk/db";
import { z } from "zod";
import { accountOf, sameOrigin } from "./account.ts";

export type RemindersDeps = { db: D1Database; appOrigin: string | undefined; now: () => Date };

const ME_PATH = "/api/me/reminders";
const OFF_PATH = /^\/api\/reminders\/off\/([^/]+)$/;
const MAX_BODY_BYTES = 256;
const Switch = z.object({ on: z.boolean() });

export const isRemindersPath = (pathname: string): boolean => pathname === ME_PATH || OFF_PATH.test(pathname);

const words = {
  en: { title: "EmberWalk reminders", ask: "Turn off EmberWalk reminder emails? You can turn them back on in Settings in the app.", button: "Turn Off Reminders", done: "Reminder emails are off. You can turn them back on in Settings in the app.", invalid: "This link does not work anymore. You can turn reminders off in Settings in the app." },
  es: { title: "Recordatorios de EmberWalk", ask: "¿Desactivar los correos de recordatorio de EmberWalk? Puede volver a activarlos en Ajustes en la aplicación.", button: "Desactivar recordatorios", done: "Los correos de recordatorio están desactivados. Puede volver a activarlos en Ajustes en la aplicación.", invalid: "Este enlace ya no funciona. Puede desactivar los recordatorios en Ajustes en la aplicación." },
};

const fail = (code: string, status: number): Response => Response.json({ error: { code, message: code } }, { status });

const page = (language: "en" | "es", text: string, form: boolean, status = 200): Response => {
  const w = words[language];
  return new Response(
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${w.title}</title></head><body style="margin:0;background:#ece6d4;font-family:'Atkinson Hyperlegible',Verdana,Arial,sans-serif;color:#1a271e;"><main style="max-width:30rem;margin:3rem auto;padding:2rem 1.5rem;background:#f7f3e6;border:2px solid #3d5a40;border-radius:16px;text-align:center"><p style="margin:0 0 1.25rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#3d5a40">EmberWalk</p><p style="font-size:1.1rem;line-height:1.5">${text}</p>${
      form ? `<form method="post"><button type="submit" style="font:inherit;font-weight:700;font-size:1.05rem;padding:0.9rem 1.75rem;border:0;border-radius:12px;background:#3d5a40;color:#f7f3e6">${w.button}</button></form>` : ""
    }</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
};

// A GET never turns anything off: mail scanners open links before the person does.
const onOff = async (request: Request, deps: RemindersDeps, token: string | null): Promise<Response> => {
  const language = new URL(request.url).searchParams.get("lang") === "es" ? "es" : "en";
  if (token === null) return page(language, words[language].invalid, false, 404);
  if (request.method === "GET") return page(language, words[language].ask, true);
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  return (await remindersOff(deps.db, token)) ? page(language, words[language].done, false) : page(language, words[language].invalid, false, 404);
};

const switchOf = async (request: Request): Promise<boolean | null> => {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = Switch.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.on : null;
  } catch {
    return null;
  }
};

const onMe = async (request: Request, deps: RemindersDeps): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "POST") return fail("method_not_allowed", 405);
  if (request.method === "POST" && !sameOrigin(request, deps.appOrigin)) return fail("forbidden_origin", 403);
  const session = await accountOf(request, deps.db, deps.now());
  if (session === null) return fail("unauthorized", 401);
  if (request.method === "POST") {
    const chosen = await switchOf(request);
    if (chosen === null) return fail("invalid_request", 400);
    await setReminders(deps.db, session.account.id, chosen);
  }
  return Response.json({ on: await remindersOn(deps.db, session.account.id) }, { headers: { "cache-control": "no-store" } });
};

const decoded = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};

export const handleReminders = async (request: Request, deps: RemindersDeps, pathname: string): Promise<Response> => {
  try {
    const off = OFF_PATH.exec(pathname);
    if (off !== null) return await onOff(request, deps, decoded(off[1] ?? ""));
    return await onMe(request, deps);
  } catch (error) {
    console.warn(`reminders ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error", 500);
  }
};
