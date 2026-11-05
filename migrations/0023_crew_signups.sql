CREATE TABLE crew_signups (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  business_name TEXT NOT NULL CHECK (length(business_name) BETWEEN 1 AND 120),
  license_number TEXT NOT NULL CHECK (length(license_number) BETWEEN 1 AND 12 AND license_number NOT GLOB '*[^0-9]*'),
  license_class TEXT NOT NULL CHECK (license_class IN ('C-27', 'C-49')),
  email TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 2 AND 20),
  zip TEXT NOT NULL CHECK (length(zip) = 5 AND zip NOT GLOB '*[^0-9]*'),
  agreed_at TEXT NOT NULL,
  last_sent_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE (license_number, license_class)
) STRICT;

CREATE INDEX crew_signups_by_class ON crew_signups (license_class, confirmed_at);

CREATE INDEX crew_signups_by_day ON crew_signups (agreed_at);

CREATE TABLE crew_signup_mail_days (
  day TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sent INTEGER NOT NULL CHECK (sent >= 0)
) STRICT;

CREATE TRIGGER crew_signups_never_to_an_optout BEFORE INSERT ON crew_signups
WHEN EXISTS (SELECT 1 FROM mail_optouts o WHERE o.address = NEW.email)
BEGIN
  SELECT RAISE(ABORT, 'that address asked to be taken off the list');
END;
