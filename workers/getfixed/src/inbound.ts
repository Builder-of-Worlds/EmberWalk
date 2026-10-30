import { jobCrews, jobForToken, messagesForJob, optOutAddress, removeLicense, saveReply } from "@emberwalk/db";
import { tryReading } from "./actions.ts";
import type { Deps } from "./deps.ts";
import { tokenOfMailbox } from "./mail.ts";
import { parseMail, RAW_LIMIT } from "./mime.ts";

export type Inbound = { from: string; to: string; raw: ReadableStream<Uint8Array>; rawSize: number; setReject(reason: string): void };

export type InboundOutcome = "saved" | "opted_out" | "rejected";

export const REJECT_UNKNOWN = "This address does not take mail.";

const OPTOUT_WORDS = /\b(unsubscribe|take me off|remove me|stop emailing|do not email|don't email)\b/i;

export const asksToBeRemoved = (subject: string | null, text: string): boolean => OPTOUT_WORDS.test(subject ?? "") || OPTOUT_WORDS.test(text.split("\n").slice(0, 3).join(" "));

const isSent = (status: string): boolean => status === "sent" || status === "replied";

export async function receive(d: Deps, mail: Inbound): Promise<InboundOutcome> {
  const reject = (): InboundOutcome => {
    mail.setReject(REJECT_UNKNOWN);
    return "rejected";
  };
  const token = tokenOfMailbox(mail.to, d.env.JOB_MAIL_DOMAIN);
  const jobId = token === null ? null : await jobForToken(d.db, token);
  if (jobId === null || mail.rawSize > RAW_LIMIT) return reject();
  const from = mail.from.trim().toLowerCase();
  const crew = (await jobCrews(d.db, jobId)).find((c) => c.email?.toLowerCase() === from);
  const sent = (await messagesForJob(d.db, jobId)).filter((m) => m.crewId === crew?.id && m.channel === "email" && isSent(m.status)).sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  const latest = sent[0];
  if (crew === undefined || latest === undefined) return reject();
  const parsed = parseMail(await new Response(mail.raw).text());
  const at = d.now().toISOString();
  if (asksToBeRemoved(parsed.subject, parsed.text)) {
    await optOutAddress(d.db, from, at);
    if (crew.licenseNumber !== null) await removeLicense(d.db, crew.licenseNumber, at.slice(0, 10));
  }
  const text = parsed.text.trim() === "" ? "(The reply had no text.)" : parsed.text;
  await saveReply(d.db, { id: d.newId(), messageId: latest.id, via: "email", fromAddress: from, subject: parsed.subject, text, receivedAt: at });
  await tryReading(d, jobId);
  return asksToBeRemoved(parsed.subject, parsed.text) ? "opted_out" : "saved";
}
