CREATE TABLE zip_centres (
  zip TEXT PRIMARY KEY CHECK (length(zip) = 5 AND zip NOT GLOB '*[^0-9]*'),
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  loaded_on TEXT NOT NULL CHECK (loaded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;

CREATE TABLE crews (
  license_number TEXT NOT NULL CHECK (length(license_number) BETWEEN 1 AND 12 AND license_number NOT GLOB '*[^0-9]*'),
  trade TEXT NOT NULL CHECK (trade IN ('C-27', 'C-49', 'D-49', 'B', 'C-13', 'C-29', 'C-39')),
  classes TEXT NOT NULL CHECK (length(classes) BETWEEN 1 AND 40 AND classes NOT GLOB '*[^BCD0-9 -]*' AND instr(' ' || classes || ' ', ' ' || trade || ' ') > 0),
  business_name TEXT NOT NULL CHECK (length(business_name) BETWEEN 1 AND 200),
  address TEXT NOT NULL CHECK (length(address) <= 300),
  zip TEXT NOT NULL CHECK (length(zip) = 5 AND zip NOT GLOB '*[^0-9]*'),
  phone TEXT NOT NULL CHECK (length(phone) <= 40),
  license_status TEXT NOT NULL CHECK (length(license_status) BETWEEN 1 AND 60),
  listed_on TEXT NOT NULL CHECK (listed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  approximate INTEGER NOT NULL DEFAULT 0 CHECK (approximate IN (0, 1)),
  PRIMARY KEY (license_number, trade)
) STRICT;

CREATE INDEX crews_by_trade_zip ON crews (trade, zip);

CREATE VIEW zip_prefix_centres AS
  SELECT substr(zip, 1, 3) AS prefix, avg(lat) AS lat, avg(lng) AS lng FROM zip_centres GROUP BY substr(zip, 1, 3);

CREATE TABLE crew_removals (
  license_number TEXT PRIMARY KEY CHECK (length(license_number) BETWEEN 1 AND 12 AND license_number NOT GLOB '*[^0-9]*'),
  requested_on TEXT NOT NULL CHECK (requested_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;
