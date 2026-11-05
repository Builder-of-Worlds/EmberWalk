import { claimReminder, releaseReminder, REMINDER_PAGE, reminderCandidates, reminderToken, type ReminderCandidate, type ReminderKind } from "@emberwalk/db";
import { sendReminderMail } from "./reminder-mail.ts";

const DAY_MS = 86_400_000;
const FIRE_SEASON_MONTH = 3;
const SEASON_GAP_MONTHS = 3;
const YEARLY_LEAD_DAYS = 17;
const AFTER_WALK_WAIT_DAYS = 3;
const AFTER_WALK_LAST_DAYS = 30;
export const MAX_SENDS_PER_RUN = 40;
const SEND_GAP_MS = 600;
// A refused mail or a bad address keeps its claim, so it is never sent again.
const RETRIED = new Set(["down", "busy", "unreachable"]);
const STOPS_RUN = new Set(["down", "busy"]);

export type DueReminder = { kind: ReminderKind; sentFor: string; dueDay: string | null };

const dayAt = (iso: string): Date => new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);

// The same rule as yearlyDue in apps/web/src/dashboard.ts; the two must stay equal.
const yearlyDue = (walked: Date): Date => {
  const soonest = new Date(Date.UTC(walked.getUTCFullYear(), walked.getUTCMonth() + SEASON_GAP_MONTHS, walked.getUTCDate(), 12));
  const due = new Date(Date.UTC(soonest.getUTCFullYear(), FIRE_SEASON_MONTH, 1, 12));
  return due < soonest ? new Date(Date.UTC(soonest.getUTCFullYear() + 1, FIRE_SEASON_MONTH, 1, 12)) : due;
};

const startOf = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export const dueReminder = (c: ReminderCandidate, now: Date): DueReminder | null => {
  const today = startOf(now);
  if (c.firstTotal > 0 && c.firstDone === c.firstTotal && c.firstDoneOn !== null) {
    const doneOn = startOf(dayAt(c.firstDoneOn));
    if (today >= doneOn + AFTER_WALK_WAIT_DAYS * DAY_MS && today < doneOn + AFTER_WALK_LAST_DAYS * DAY_MS) return { kind: "after_walk", sentFor: c.walkId, dueDay: null };
  }
  const due = yearlyDue(dayAt(c.walkDay));
  if (today >= startOf(due) - YEARLY_LEAD_DAYS * DAY_MS && today < startOf(due)) return { kind: "yearly", sentFor: String(due.getUTCFullYear()), dueDay: due.toISOString().slice(0, 10) };
  return null;
};

export type ReminderRunDeps = {
  db: D1Database;
  apiKey: string | undefined;
  footer: string | undefined;
  appOrigin: string | undefined;
  fetch: typeof fetch;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
  log: (line: string) => void;
  pageSize?: number;
};

export const sendReminders = async (deps: ReminderRunDeps): Promise<{ sent: number; failed: number }> => {
  const tally = { sent: 0, failed: 0 };
  if (deps.apiKey === undefined || deps.apiKey === "" || deps.footer === undefined || deps.footer === "" || deps.appOrigin === undefined || deps.appOrigin === "") {
    deps.log("reminders: not set up (RESEND_API_KEY, POSTAL_FOOTER or APP_ORIGIN missing)");
    return tally;
  }
  const now = deps.now();
  const size = deps.pageSize ?? REMINDER_PAGE;
  let tried = 0;
  let after = "";
  for (;;) {
    const page = await reminderCandidates(deps.db, after, size);
    for (const candidate of page) {
      if (tried >= MAX_SENDS_PER_RUN) return tally;
      const due = dueReminder(candidate, now);
      if (due === null) continue;
      const claim = { accountId: candidate.accountId, kind: due.kind, sentFor: due.sentFor };
      if (!(await claimReminder(deps.db, { ...claim, at: now.toISOString() }))) continue;
      tried += 1;
      const sent = await mailOne({ ...deps, apiKey: deps.apiKey, footer: deps.footer, appOrigin: deps.appOrigin }, candidate, due);
      if (sent.ok) {
        tally.sent += 1;
        await deps.wait(SEND_GAP_MS);
        continue;
      }
      if (RETRIED.has(sent.code)) await releaseReminder(deps.db, claim);
      tally.failed += 1;
      deps.log(`reminders: ${due.kind} for ${candidate.accountId} failed: ${sent.code}`);
      if (STOPS_RUN.has(sent.code)) return tally;
    }
    if (page.length < size) return tally;
    after = page[page.length - 1]!.accountId;
  }
};

const mailOne = async (deps: ReminderRunDeps & { apiKey: string; footer: string; appOrigin: string }, candidate: ReminderCandidate, due: DueReminder) =>
  sendReminderMail({
    apiKey: deps.apiKey,
    footer: deps.footer,
    appOrigin: deps.appOrigin,
    to: candidate.email,
    language: candidate.language,
    kind: due.kind,
    dueDay: due.dueDay,
    walkDay: candidate.walkDay,
    done: candidate.done,
    total: candidate.total,
    offUrl: `${deps.appOrigin}/api/reminders/off/${await reminderToken(deps.db, candidate.accountId)}?lang=${candidate.language}`,
    idempotencyKey: `reminder-${due.kind}-${candidate.accountId}-${due.sentFor}`,
    fetch: deps.fetch,
  });
