CREATE TABLE plans (
  customer_id TEXT PRIMARY KEY CHECK (customer_id GLOB 'cus_?*' AND length(customer_id) <= 255 AND customer_id NOT GLOB '*[^A-Za-z0-9_]*'),
  visitor_id TEXT CHECK (visitor_id IS NULL OR (length(visitor_id) = 64 AND visitor_id NOT GLOB '*[^0-9a-f]*')),
  subscription_id TEXT UNIQUE CHECK (subscription_id IS NULL OR (subscription_id GLOB 'sub_?*' AND length(subscription_id) <= 255 AND subscription_id NOT GLOB '*[^A-Za-z0-9_]*')),
  status TEXT NOT NULL CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  renews_at TEXT CHECK (renews_at IS NULL OR renews_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  price_id TEXT CHECK (price_id IS NULL OR (price_id GLOB 'price_?*' AND length(price_id) <= 255 AND price_id NOT GLOB '*[^A-Za-z0-9_]*')),
  period_start TEXT CHECK (period_start IS NULL OR period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  started_at TEXT CHECK (started_at IS NULL OR started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  extra_walks_used INTEGER NOT NULL DEFAULT 0 CHECK (extra_walks_used >= 0),
  event_at INTEGER NOT NULL CHECK (event_at >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX plans_by_visitor ON plans (visitor_id, event_at);

CREATE TABLE extra_walks (
  session_id TEXT PRIMARY KEY CHECK (session_id GLOB 'cs_?*' AND length(session_id) <= 255 AND session_id NOT GLOB '*[^A-Za-z0-9_]*'),
  customer_id TEXT NOT NULL CHECK (customer_id GLOB 'cus_?*' AND length(customer_id) <= 255 AND customer_id NOT GLOB '*[^A-Za-z0-9_]*'),
  payment_intent TEXT UNIQUE CHECK (payment_intent IS NULL OR (payment_intent GLOB 'pi_?*' AND length(payment_intent) <= 255 AND payment_intent NOT GLOB '*[^A-Za-z0-9_]*')),
  walks INTEGER NOT NULL CHECK (walks BETWEEN 1 AND 15),
  paid_at TEXT NOT NULL CHECK (paid_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  refunded_at TEXT CHECK (refunded_at IS NULL OR refunded_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX extra_walks_by_customer ON extra_walks (customer_id, paid_at);

CREATE TABLE refunded_charges (
  charge_id TEXT PRIMARY KEY CHECK ((charge_id GLOB 'ch_?*' OR charge_id GLOB 'py_?*') AND length(charge_id) <= 255 AND charge_id NOT GLOB '*[^A-Za-z0-9_]*'),
  customer_id TEXT CHECK (customer_id IS NULL OR (customer_id GLOB 'cus_?*' AND length(customer_id) <= 255 AND customer_id NOT GLOB '*[^A-Za-z0-9_]*')),
  payment_intent TEXT CHECK (payment_intent IS NULL OR (payment_intent GLOB 'pi_?*' AND length(payment_intent) <= 255 AND payment_intent NOT GLOB '*[^A-Za-z0-9_]*')),
  purpose TEXT NOT NULL CHECK (purpose IN ('plan', 'extra_walks')),
  charged_at TEXT NOT NULL CHECK (charged_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  refunded_at TEXT NOT NULL CHECK (refunded_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX refunded_charges_by_payment ON refunded_charges (payment_intent);

CREATE INDEX refunded_charges_by_customer ON refunded_charges (customer_id, purpose, charged_at);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY CHECK (id GLOB 'evt_?*' AND length(id) <= 255 AND id NOT GLOB '*[^A-Za-z0-9_]*'),
  type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 100),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
