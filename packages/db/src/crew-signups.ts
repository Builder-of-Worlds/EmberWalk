import { Crew, CrewSignupRequest, Id, Timestamp } from "@emberwalk/shared";
import { z } from "zod";
import { jobCrews, MAX_JOB_CREWS } from "./agent.ts";
import { CapReached, DbRefused } from "./errors.ts";

export const GOOD_STANDING_SQL = "lower(trim(c.license_status)) IN ('clear', 'active')";

export type SignupStep = { outcome: "send"; id: string; email: string } | { outcome: "quiet" | "license_listed" | "license_waiting" };

export type ListedSignup = {
  businessName: string;
  licenseNumber: string;
  licenseClass: string;
  email: string;
  phone: string | null;
  zip: string;
  licenseStatus: string;
  listedOn: string;
  approximate: boolean;
  lat: number;
  lng: number;
};

export const licenseOnStateList = async (db: D1Database, licenseNumber: string, licenseClass: string): Promise<boolean> =>
  (await db.prepare(`SELECT 1 AS x FROM crews c WHERE c.license_number = ? AND c.trade = ? AND ${GOOD_STANDING_SQL}`).bind(licenseNumber, licenseClass).first()) !== null;

const signupByEmail = (db: D1Database, email: string): Promise<{ id: string; confirmed_at: string | null; last_sent_at: string } | null> =>
  db.prepare("SELECT id, confirmed_at, last_sent_at FROM crew_signups WHERE email = ?").bind(email).first();

const RESEND_MS = 60 * 60_000;
const UNCONFIRMED_MS = 24 * 60 * 60_000;

const unconfirmedSince = (at: string): string => new Date(Date.parse(at) - UNCONFIRMED_MS).toISOString();

const takeMailSlot = async (db: D1Database, at: string, perDay: number): Promise<void> => {
  const result = await db
    .prepare("INSERT INTO crew_signup_mail_days (day, sent) SELECT ?1, 1 WHERE ?2 > 0 ON CONFLICT (day) DO UPDATE SET sent = sent + 1 WHERE sent < ?2")
    .bind(at.slice(0, 10), perDay)
    .run();
  if (result.meta.changes !== 1) throw new CapReached("too many crew signup emails today");
};

export const saveCrewSignup = async (db: D1Database, input: z.infer<typeof CrewSignupRequest>, o: { id: string; at: string; perDay: number }): Promise<SignupStep> => {
  const s = CrewSignupRequest.parse(input);
  const email = s.email.toLowerCase();
  const when = Timestamp.parse(o.at);
  await db.prepare("DELETE FROM crew_signups WHERE confirmed_at IS NULL AND agreed_at < ?").bind(unconfirmedSince(when)).run();
  const optedOut = await db.prepare("SELECT 1 AS x FROM mail_optouts WHERE address = ?").bind(email).first();
  const held = await signupByEmail(db, email);
  if (held?.confirmed_at != null) return { outcome: "quiet" };
  if (optedOut !== null) throw new DbRefused("that address asked to be taken off the list");
  if (held !== null) {
    if (held.last_sent_at > new Date(Date.parse(when) - RESEND_MS).toISOString()) return { outcome: "quiet" };
    await takeMailSlot(db, when, o.perDay);
    await db.prepare("UPDATE crew_signups SET last_sent_at = ? WHERE id = ?").bind(when, held.id).run();
    return { outcome: "send", id: held.id, email };
  }
  const license = await db.prepare("SELECT confirmed_at FROM crew_signups WHERE license_number = ? AND license_class = ?").bind(s.licenseNumber, s.licenseClass).first<{ confirmed_at: string | null }>();
  if (license !== null) return { outcome: license.confirmed_at === null ? "license_waiting" : "license_listed" };
  await takeMailSlot(db, when, o.perDay);
  await db
    .prepare("INSERT INTO crew_signups (id, business_name, license_number, license_class, email, phone, zip, agreed_at, last_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(Id.parse(o.id), s.businessName, s.licenseNumber, s.licenseClass, email, s.phone, s.zip, when, when)
    .run()
    .catch((error: unknown) => {
      throw new DbRefused(`crew signup refused: ${error instanceof Error ? error.message : String(error)}`);
    });
  return { outcome: "send", id: o.id, email };
};

export const confirmCrewSignup = async (db: D1Database, id: string, at: string): Promise<boolean> => {
  const key = Id.parse(id);
  const when = Timestamp.parse(at);
  await db.prepare("UPDATE crew_signups SET confirmed_at = ? WHERE id = ? AND confirmed_at IS NULL AND agreed_at >= ?").bind(when, key, unconfirmedSince(when)).run();
  return (await db.prepare("SELECT 1 AS x FROM crew_signups WHERE id = ? AND confirmed_at IS NOT NULL").bind(key).first()) !== null;
};

export const removeCrewSignup = async (db: D1Database, id: string): Promise<string | null> => {
  const row = await db.prepare("DELETE FROM crew_signups WHERE id = ? RETURNING email").bind(Id.parse(id)).first<{ email: string }>();
  return row?.email ?? null;
};

type ListedRow = { business_name: string; license_number: string; license_class: string; email: string; phone: string | null; zip: string; license_status: string; listed_on: string; approximate: number; lat: number; lng: number };

export const listedSignups = async (db: D1Database, classes: readonly string[]): Promise<ListedSignup[]> => {
  if (classes.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT s.business_name, s.license_number, s.license_class, s.email, s.phone, s.zip, c.license_status, c.listed_on, c.approximate, z.lat, z.lng
       FROM crew_signups s
       JOIN crews c ON c.license_number = s.license_number AND c.trade = s.license_class AND ${GOOD_STANDING_SQL}
       JOIN zip_centres z ON z.zip = s.zip
       WHERE s.confirmed_at IS NOT NULL AND s.license_class IN (${classes.map(() => "?").join(", ")})
         AND NOT EXISTS (SELECT 1 FROM mail_optouts o WHERE o.address = s.email)
         AND NOT EXISTS (SELECT 1 FROM crew_removals r WHERE r.license_number = s.license_number)`,
    )
    .bind(...classes)
    .all<ListedRow>();
  return results.map((r) => ({
    businessName: r.business_name,
    licenseNumber: r.license_number,
    licenseClass: r.license_class,
    email: r.email,
    phone: r.phone,
    zip: r.zip,
    licenseStatus: r.license_status,
    listedOn: r.listed_on,
    approximate: r.approximate === 1,
    lat: r.lat,
    lng: r.lng,
  }));
};

export const addNamedCrew = async (db: D1Database, jobId: string, crew: Crew): Promise<void> => {
  const id = Id.parse(jobId);
  const named = Crew.parse(crew);
  const written = await db.prepare("SELECT 1 AS x FROM agent_messages WHERE job_id = ? LIMIT 1").bind(id).first();
  if (written !== null) throw new DbRefused(`job ${jobId} already has its requests`);
  const held = await jobCrews(db, id);
  const replaced = held.length < MAX_JOB_CREWS ? null : ([...held].reverse().find((c) => c.licenseNumber !== null) ?? null);
  if (held.length >= MAX_JOB_CREWS && replaced === null) throw new DbRefused(`job ${jobId} already has ${MAX_JOB_CREWS} named crews`);
  const position = replaced === null ? held.length + 1 : held.findIndex((c) => c.id === replaced.id) + 1;
  await db.batch([
    ...(replaced === null ? [] : [db.prepare("DELETE FROM agent_job_crews WHERE job_id = ? AND crew_id = ?").bind(id, replaced.id)]),
    db.prepare("INSERT INTO agent_job_crews (job_id, crew_id, position, crew) VALUES (?, ?, ?, ?)").bind(id, named.id, position, JSON.stringify(named)),
  ]);
};
