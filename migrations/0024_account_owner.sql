ALTER TABLE accounts ADD COLUMN owner_id TEXT CHECK (owner_id IS NULL OR (length(owner_id) = 64 AND owner_id NOT GLOB '*[^0-9a-f]*'));

CREATE UNIQUE INDEX accounts_by_owner ON accounts (owner_id) WHERE owner_id IS NOT NULL;

UPDATE accounts SET owner_id = (
  SELECT s.visitor_id FROM sessions s
  WHERE s.account_id = accounts.id AND s.same_phone = 0 AND s.ended_at = s.created_at AND julianday(s.expires_at) - julianday(s.created_at) < 0.001
  LIMIT 1
);

DELETE FROM sessions WHERE same_phone = 0 AND ended_at = created_at AND julianday(expires_at) - julianday(created_at) < 0.001;

ALTER TABLE walks ADD COLUMN plan_visitor TEXT CHECK (plan_visitor IS NULL OR (length(plan_visitor) = 64 AND plan_visitor NOT GLOB '*[^0-9a-f]*'));

CREATE INDEX walks_by_plan_visitor ON walks (plan_visitor) WHERE plan_visitor IS NOT NULL;
