ALTER TABLE accounts ADD COLUMN reminders INTEGER NOT NULL DEFAULT 1 CHECK (reminders IN (0, 1));

ALTER TABLE accounts ADD COLUMN reminder_token TEXT CHECK (reminder_token IS NULL OR (length(reminder_token) = 64 AND reminder_token NOT GLOB '*[^0-9a-f]*'));

CREATE UNIQUE INDEX accounts_by_reminder_token ON accounts (reminder_token) WHERE reminder_token IS NOT NULL;

CREATE TABLE reminder_sends (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('yearly', 'after_walk')),
  sent_for TEXT NOT NULL CHECK (length(sent_for) BETWEEN 4 AND 36),
  sent_at TEXT NOT NULL,
  PRIMARY KEY (account_id, kind, sent_for)
) STRICT;
