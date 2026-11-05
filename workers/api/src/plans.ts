import { onPlanOf } from "@emberwalk/db";
import { holdsPlan, type StripeStatus } from "@emberwalk/shared";

export type PlanRow = {
  customerId: string;
  visitorId: string | null;
  subscriptionId: string | null;
  status: StripeStatus;
  renewsAt: string | null;
  priceId: string | null;
  periodStart: string | null;
  refundedChargeAt: string | null;
  extraWalksUsed: number;
  eventAt: number;
};

export type PlanChange =
  | { kind: "linked"; customerId: string; visitorId: string | null; subscriptionId: string | null; paid: boolean }
  | {
      kind: "subscription";
      customerId: string;
      visitorId: string | null;
      subscriptionId: string;
      status: StripeStatus;
      renewsAt: string | null;
      priceId: string | null;
      periodStart: string | null;
      startedAt: string;
      eventAt: number;
      rolloverCap: number | null;
    }
  | { kind: "extra"; sessionId: string; customerId: string; paymentIntent: string | null; walks: number; paidAt: string }
  | {
      kind: "refunded";
      chargeId: string;
      customerId: string | null;
      paymentIntent: string | null;
      purpose: "plan" | "extra_walks";
      chargedAt: string;
      refundedAt: string;
    };

export type Recorded = "applied" | "duplicate";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const COLUMNS =
  "customer_id AS customerId, visitor_id AS visitorId, subscription_id AS subscriptionId, status, renews_at AS renewsAt, price_id AS priceId, period_start AS periodStart, extra_walks_used AS extraWalksUsed, event_at AS eventAt, (SELECT max(r.charged_at) FROM refunded_charges r WHERE r.customer_id = plans.customer_id AND r.purpose = 'plan' AND (plans.started_at IS NULL OR r.charged_at >= plans.started_at)) AS refundedChargeAt";

export const COUNTED_WALK = "w.part_of IS NULL AND w.id NOT IN (SELECT walk_id FROM walk_parts) AND w.synthetic = 0 AND w.state <> 'failed'";

const HOLDING_FIRST = "CASE WHEN status IN ('active', 'trialing', 'past_due') THEN 1 ELSE 0 END DESC, event_at DESC, updated_at DESC";

export const CHARGE_BEFORE_PERIOD_MS = 24 * 3600 * 1000;

export const refundedInFull = (plan: Pick<PlanRow, "refundedChargeAt" | "periodStart">): boolean =>
  plan.refundedChargeAt !== null &&
  (plan.periodStart === null || Date.parse(plan.refundedChargeAt) >= Date.parse(plan.periodStart) - CHARGE_BEFORE_PERIOD_MS);

export const holdsLivePlan = (plan: PlanRow): boolean => holdsPlan(plan.status) && !refundedInFull(plan);

export const planOf = async (db: D1Database, visitorId: string): Promise<PlanRow | null> => {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM plans WHERE visitor_id = ? ORDER BY ${HOLDING_FIRST}`).bind(visitorId).all<PlanRow>();
  return results.find(holdsLivePlan) ?? results[0] ?? null;
};

export const planByCustomer = async (db: D1Database, customerId: string): Promise<PlanRow | null> =>
  db.prepare(`SELECT ${COLUMNS} FROM plans WHERE customer_id = ?`).bind(customerId).first<PlanRow>();

export const unlinkVisitor = async (db: D1Database, visitorId: string): Promise<void> => {
  await db.batch([
    db.prepare(`UPDATE plans SET visitor_id = NULL, updated_at = ${NOW} WHERE visitor_id = ?`).bind(visitorId),
    db.prepare("DELETE FROM stripe_customers WHERE visitor_id = ?").bind(visitorId),
  ]);
};

export const storedCustomer = async (db: D1Database, visitorId: string): Promise<string | null> =>
  (await db.prepare("SELECT customer_id AS id FROM stripe_customers WHERE visitor_id = ?").bind(visitorId).first<{ id: string }>())?.id ?? null;

export const keepCustomer = async (db: D1Database, visitorId: string, customerId: string): Promise<{ customerId: string; kept: boolean }> => {
  const insert = await db.prepare("INSERT INTO stripe_customers (visitor_id, customer_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(visitorId, customerId).run();
  return insert.meta.changes > 0 ? { customerId, kept: true } : { customerId: (await storedCustomer(db, visitorId)) ?? customerId, kept: false };
};

export const extraWalksBought = async (db: D1Database, customerId: string): Promise<number> =>
  (await db.prepare("SELECT coalesce(sum(walks), 0) AS n FROM extra_walks WHERE customer_id = ? AND refunded_at IS NULL").bind(customerId).first<{ n: number }>())?.n ?? 0;

const COUNTED_WALKS = `SELECT count(*) AS n FROM walks w WHERE (w.visitor_id = ?1 OR w.visitor_id = ?3 OR w.plan_visitor = ?1 OR w.${onPlanOf("?1")}) AND ${COUNTED_WALK} AND (?2 IS NULL OR w.created_at >= ?2)`;

export const walksThisPlanYear = async (db: D1Database, visitor: string, periodStart: string | null, phone: string = visitor): Promise<number> =>
  (await db.prepare(COUNTED_WALKS).bind(visitor, periodStart, phone).first<{ n: number }>())?.n ?? 0;

export const walksAllowed = async (db: D1Database, plan: PlanRow, walksPerYear: number): Promise<number> =>
  walksPerYear + Math.max(0, (await extraWalksBought(db, plan.customerId)) - plan.extraWalksUsed);

const ROLLOVER = `UPDATE plans SET extra_walks_used = extra_walks_used + max(0, (SELECT count(*) FROM walks w
    WHERE (w.visitor_id = plans.visitor_id OR w.plan_visitor = plans.visitor_id OR w.${onPlanOf("plans.visitor_id")}) AND ${COUNTED_WALK} AND w.created_at >= plans.period_start AND w.created_at < ?2) - ?3)
  WHERE customer_id = ?1 AND period_start IS NOT NULL AND period_start < ?2 AND event_at <= ?4`;

const statementsOf = (db: D1Database, change: PlanChange): D1PreparedStatement[] => {
  switch (change.kind) {
    case "extra":
      return [
        db
          .prepare(
            `INSERT INTO extra_walks (session_id, customer_id, payment_intent, walks, paid_at, refunded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, (SELECT refunded_at FROM refunded_charges WHERE payment_intent = ?3)) ON CONFLICT DO NOTHING`,
          )
          .bind(change.sessionId, change.customerId, change.paymentIntent, change.walks, change.paidAt),
      ];
    case "refunded":
      return [
        db
          .prepare(
            `INSERT INTO refunded_charges (charge_id, customer_id, payment_intent, purpose, charged_at, refunded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT DO NOTHING`,
          )
          .bind(change.chargeId, change.customerId, change.paymentIntent, change.purpose, change.chargedAt, change.refundedAt),
        db.prepare("UPDATE extra_walks SET refunded_at = ?2 WHERE payment_intent = ?1 AND refunded_at IS NULL").bind(change.paymentIntent, change.refundedAt),
      ];
    case "subscription":
      return change.rolloverCap === null || change.periodStart === null
        ? [statementOf(db, change)]
        : [db.prepare(ROLLOVER).bind(change.customerId, change.periodStart, change.rolloverCap, change.eventAt), statementOf(db, change)];
    default:
      return [statementOf(db, change)];
  }
};

const statementOf = (db: D1Database, change: Exclude<PlanChange, { kind: "extra" | "refunded" }>): D1PreparedStatement => {
  switch (change.kind) {
    case "linked":
      return db
        .prepare(
          `INSERT INTO plans (customer_id, visitor_id, subscription_id, status, event_at) VALUES (?1, ?2, ?3, ?4, 0)
           ON CONFLICT (customer_id) DO UPDATE SET subscription_id = coalesce(plans.subscription_id, excluded.subscription_id), updated_at = ${NOW}`,
        )
        .bind(change.customerId, change.visitorId, change.subscriptionId, change.paid ? "active" : "incomplete");
    case "subscription":
      return db
        .prepare(
          `INSERT INTO plans (customer_id, visitor_id, subscription_id, status, renews_at, price_id, period_start, started_at, event_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (customer_id) DO UPDATE SET subscription_id = excluded.subscription_id, status = excluded.status,
             renews_at = excluded.renews_at, price_id = excluded.price_id, period_start = excluded.period_start, started_at = excluded.started_at,
             event_at = excluded.event_at, updated_at = ${NOW}
           WHERE excluded.event_at >= plans.event_at`,
        )
        .bind(change.customerId, change.visitorId, change.subscriptionId, change.status, change.renewsAt, change.priceId, change.periodStart, change.startedAt, change.eventAt);
  }
};

const isDuplicate = (error: unknown): boolean => error instanceof Error && /UNIQUE constraint failed: stripe_events\.id/.test(error.message);

export const eventSeen = async (db: D1Database, eventId: string): Promise<boolean> =>
  (await db.prepare("SELECT 1 AS seen FROM stripe_events WHERE id = ?").bind(eventId).first()) !== null;

export const walkLanguageOf = async (db: D1Database, visitorId: string): Promise<"en" | "es"> =>
  (await db.prepare("SELECT language FROM walks WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 1").bind(visitorId).first<{ language: string }>())?.language === "es" ? "es" : "en";

export const recordEvent = async (db: D1Database, event: { id: string; type: string }, change: PlanChange | null): Promise<Recorded> => {
  const seen = await db.prepare("SELECT 1 AS seen FROM stripe_events WHERE id = ?").bind(event.id).first();
  if (seen !== null) return "duplicate";
  const insert = db.prepare("INSERT INTO stripe_events (id, type) VALUES (?, ?)").bind(event.id, event.type);
  try {
    await db.batch(change === null ? [insert] : [insert, ...statementsOf(db, change)]);
    return "applied";
  } catch (error) {
    if (isDuplicate(error)) return "duplicate";
    throw error;
  }
};
