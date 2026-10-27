CREATE TABLE signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  role TEXT NOT NULL CHECK (role IN ('homeowner', 'landlord', 'other')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  welcomed_at TEXT
);
