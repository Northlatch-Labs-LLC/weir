-- Every failure the product knows about, in one place, so an outage is a query rather than a memory.
--
-- The site had no error capture of any kind: failures became a console line in a log nobody reads
-- and the client got an opaque sentence. This table is the smallest thing that turns that around.

CREATE TABLE IF NOT EXISTS error_events (
  id          BIGSERIAL PRIMARY KEY,
  at_ms       BIGINT      NOT NULL,
  source      TEXT        NOT NULL,
  detail      TEXT        NOT NULL,
  route       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reads are always "recent first".
CREATE INDEX IF NOT EXISTS error_events_at_idx ON error_events (at_ms DESC);
CREATE INDEX IF NOT EXISTS error_events_source_idx ON error_events (source, at_ms DESC);

-- Nothing here is meant to be permanent. A year of detail is plenty and the table must not grow
-- without a bound.
COMMENT ON TABLE error_events IS 'Application failures. Prune rows older than 365 days.';
