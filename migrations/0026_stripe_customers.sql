CREATE TABLE stripe_customers (
  visitor_id TEXT PRIMARY KEY CHECK (length(visitor_id) = 64 AND visitor_id NOT GLOB '*[^0-9a-f]*'),
  customer_id TEXT NOT NULL UNIQUE CHECK (customer_id GLOB 'cus_?*' AND length(customer_id) <= 255 AND customer_id NOT GLOB '*[^A-Za-z0-9_]*')
) STRICT;
