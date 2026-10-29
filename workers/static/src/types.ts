export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET?: string;
  RESEND_API_KEY?: string;
  UNSUBSCRIBE_SECRET?: string;
  POSTAL_FOOTER?: string;
}

export interface Message {
  to: string;
  subject: string;
  body: string;
  unsubscribeUrl: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

export interface Deps {
  fetchImpl: typeof fetch;
  mailer: Mailer | null;
}

export const ROLES = ["homeowner", "landlord", "other"] as const;
export type Role = (typeof ROLES)[number];
