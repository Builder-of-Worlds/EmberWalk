import { type Outbox, SendRefused } from "@emberwalk/agent";
import { jobAddress, outboxBegin, outboxDone, outboxState } from "@emberwalk/db";
import type { Crew, OutgoingMessage } from "@emberwalk/shared";

export const RESEND_URL = "https://api.resend.com/emails";
export const FROM_NAME = "EmberWalk";
export const draft = {
  optoutLine: "To be taken off the list, use this link, or reply to this email and say so:",
};
export const OPTOUT_LINE = draft.optoutLine;
export const OPTOUT_PATH = "/api/crew-optout/";

export type MailConfig = { apiKey: string; footer: string; optoutSecret: string; domain: string; origin: string };

export type MailEnv = { RESEND_API_KEY?: string; MAIL_FOOTER?: string; OPTOUT_SECRET?: string; JOB_MAIL_DOMAIN: string; APP_ORIGIN: string };

export class MailOff extends Error {
  constructor(missing: string[]) {
    super(`email is not set up on this server: ${missing.join(", ")} missing`);
    this.name = "MailOff";
  }
}

export class MailFailed extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MailFailed";
  }
}

export const mailConfig = (env: MailEnv): MailConfig => {
  const missing = (["RESEND_API_KEY", "MAIL_FOOTER", "OPTOUT_SECRET"] as const).filter((k) => !env[k]?.trim());
  if (missing.length > 0) throw new MailOff(missing);
  return { apiKey: env.RESEND_API_KEY!, footer: env.MAIL_FOOTER!.trim(), optoutSecret: env.OPTOUT_SECRET!, domain: env.JOB_MAIL_DOMAIN, origin: env.APP_ORIGIN };
};

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

const signature = async (secret: string, messageId: string): Promise<string> => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`optout:${messageId}`))).slice(0, 32);
};

export const optoutToken = async (secret: string, messageId: string): Promise<string> => `${messageId}.${await signature(secret, messageId)}`;

export const messageOfToken = async (secret: string, token: string): Promise<string | null> => {
  const match = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/.exec(token);
  if (match === null) return null;
  const [, messageId = "", given = ""] = match;
  const expected = await signature(secret, messageId);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0 ? messageId : null;
};

export const jobMailbox = (token: string, domain: string): string => `jobs+${token}@${domain}`;

export const tokenOfMailbox = (to: string, domain: string): string | null => {
  const match = /^jobs\+([a-z0-9]{16})@(.+)$/.exec(to.trim().toLowerCase());
  return match !== null && match[2] === domain.toLowerCase() ? (match[1] ?? null) : null;
};

export const mailText = (body: string, link: string, footer: string): string => `${body}\n\n${OPTOUT_LINE} ${link}\n\n${footer}`;

export const base64Of = (bytes: Uint8Array): string => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

export type Attachment = { filename: string; content: string };

export type ResendDeps = {
  db: D1Database;
  config: MailConfig;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  stills: (message: OutgoingMessage) => Promise<Uint8Array[]>;
  newToken: () => string;
  now: () => Date;
};

export const resendOutbox = (deps: ResendDeps): Outbox => ({
  async send(message: OutgoingMessage, crew: Crew): Promise<void> {
    if (message.channel !== "email" || crew.email === null) throw new SendRefused(`message ${message.id} is not an email to a crew with an address`);
    const at = () => deps.now().toISOString();
    const token = await jobAddress(deps.db, message.jobId, deps.newToken, at());
    if (!(await outboxBegin(deps.db, message.id, at()))) {
      if ((await outboxState(deps.db, message.id))?.state === "sent") return;
      throw new SendRefused(`message ${message.id} is already in the outbox`);
    }
    try {
      const { config } = deps;
      const mailbox = jobMailbox(token, config.domain);
      const link = `${config.origin}${OPTOUT_PATH}${await optoutToken(config.optoutSecret, message.id)}`;
      const attachments: Attachment[] = (await deps.stills(message)).map((bytes, i) => ({ filename: `photo-${i + 1}.jpg`, content: base64Of(bytes) }));
      const response = await deps.fetch(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", "idempotency-key": message.id },
        body: JSON.stringify({
          from: `${FROM_NAME} <${mailbox}>`,
          to: [crew.email],
          reply_to: mailbox,
          subject: message.subject ?? "",
          text: mailText(message.body, link, config.footer),
          attachments,
          headers: { "List-Unsubscribe": `<${link}>, <mailto:${mailbox}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
      });
      const answer = (await response.json().catch(() => ({}))) as { id?: unknown; message?: unknown };
      if (!response.ok || typeof answer.id !== "string") throw new MailFailed(`the mail service said ${response.status}${typeof answer.message === "string" ? `: ${answer.message}` : ""}`);
      await outboxDone(deps.db, message.id, at(), { providerId: answer.id });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await outboxDone(deps.db, message.id, at(), { error: detail });
      throw error instanceof MailFailed ? error : new MailFailed(detail);
    }
  },
});
