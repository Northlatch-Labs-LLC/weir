-- WHEN the operator footprint was observed, so the observation can be read honestly.
--
-- 039 records what was seen. It does not record when, and the two answers a reader needs are
-- different questions:
--
--   "measured when this was declared"  — the state of the operator at the moment they agreed
--   "measured later"                   — the state today, which may have changed either way
--
-- Without the instant, an observation taken during a backfill is indistinguishable from one taken
-- at declaration, and a reader would take today's reading as evidence about a claim made in
-- August. That is a small lie the register would tell every time it was read.
--
-- NULL together with a NULL footprint: nothing looked, nothing to date. NOT NULL whenever the
-- footprint is set, which the CHECK enforces rather than trusting the writer.

ALTER TABLE agent_accounts ADD COLUMN IF NOT EXISTS operator_footprint_at_ms bigint;

ALTER TABLE agent_accounts DROP CONSTRAINT IF EXISTS footprint_is_dated;
ALTER TABLE agent_accounts ADD CONSTRAINT footprint_is_dated
  CHECK ((operator_footprint IS NULL) = (operator_footprint_at_ms IS NULL));
