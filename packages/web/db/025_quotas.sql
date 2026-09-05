-- Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- 025_quotas.sql — the request ceiling stops being per-process.
--
-- # What was wrong, and why nobody noticed
--
-- `lib/rate-limit.ts` keeps its counters in a module-scope `Map`. Its own doc block says so, and
-- says why: a Next proxy may be deployed to a CDN and must not rely on shared globals, so the state
-- was put where module state actually survives — the route handler's Node instance. It then states
-- the limitation plainly, in the file, from the day it was written:
--
--     "Serverless multiplies instances, and each instance counts on its own. A caller spread
--      across many instances gets more than `limit` requests."
--
-- Nobody noticed because for a browser audience it was never wrong enough to see. A person makes a
-- handful of requests a minute and lands on one warm instance; `limit × instances` and `limit` are
-- the same number to them, and the limiter did the job it was written for — stopping a naive loop
-- against a warm instance, cheaply.
--
-- An agent is not that caller. It is deliberately concurrent, it retries on failure, and the
-- request rate that makes a browser limiter bite is its normal operating speed. At that rate
-- `limit × instances` is not a ceiling: it is a number the caller raises by opening more
-- connections, and the platform raises for them by scaling out under exactly the load that needs
-- limiting. A ceiling that rises with the pressure on it is not a ceiling.
--
-- So the counters that must actually hold move to the one place every instance shares. This does
-- not delete the in-process limiter; the two answer different questions, and `lib/rate-limit.ts`
-- says which is which.
--
-- # What the columns are
--
-- `address`         the caller, normalised (lower-cased, zero-padded). A quota keyed on the raw
--                   string is no quota at all: the same address arrives from a wallet, a query
--                   string and an event log in three different cases, and an agent that noticed
--                   would mint a fresh bucket per request by flipping one hex digit's case.
-- `bucket`          which ceiling — `read`, `write` or `purchase`. Separate namespaces, so a
--                   cheap read cannot exhaust the budget that bounds spending.
-- `tokens`          how many requests are available right now, at the last moment this row was
--                   written. Never negative and never above the bucket's capacity.
-- `refilled_at_ms`  the instant `tokens` was correct as of. Time since then is what the refill
--                   converts into new tokens.
--
-- # A token bucket rather than a sliding window
--
-- The in-process limiter keeps an array of hit timestamps per key. That is the right shape in
-- memory and the wrong one in a table: it is a row per request, an unbounded array per caller, and
-- a delete-then-count on every call. A bucket is two integers and one statement, and it gives what
-- an agent actually needs — a burst allowance (`capacity`) that is distinct from a sustained rate
-- (one token every `ms_per_token`), so a client can be told both numbers and pace itself.
--
-- # THE CONCURRENCY GUARANTEE, which is the entire point of this table
--
-- The refill and the decrement happen in ONE statement:
--
--     INSERT INTO agent_quotas AS q (address, bucket, tokens, refilled_at_ms)
--     VALUES ($1, $2, $3 - $4, $5)
--     ON CONFLICT (address, bucket) DO UPDATE
--        SET tokens = LEAST($3::bigint,
--                            q.tokens + (GREATEST(0, $5 - q.refilled_at_ms) / $6))::int - $4,
--            refilled_at_ms = q.refilled_at_ms + (GREATEST(0, $5 - q.refilled_at_ms) / $6) * $6
--      WHERE LEAST($3::bigint,
--                  q.tokens + (GREATEST(0, $5 - q.refilled_at_ms) / $6)) >= $4
--     RETURNING tokens
--
--     $1 address  $2 bucket  $3 capacity  $4 cost  $5 now_ms  $6 ms_per_token
--
-- The cap is applied in the bigint domain and cast down afterwards, not before. A row nobody has
-- touched for a year earns more tokens than an `integer` holds, and casting that intermediate would
-- abort the statement with "integer out of range" — a limiter that fails on its quietest callers.
--
-- One statement is one transaction; no BEGIN is written because wrapping a lone statement adds two
-- round trips and nothing else. What makes it safe is what Postgres does on the conflict: it takes
-- a row-level exclusive lock on the conflicting row, waits for any other transaction holding it,
-- and then evaluates the `SET` and the `WHERE` **against the latest committed version of that
-- row** — not against the snapshot the statement began with. So the second of two simultaneous
-- spenders computes its refill and its affordability test on the row the first one left behind.
-- Two callers cannot both read `tokens = 1` and both write `tokens = 0`.
--
-- Read-then-update would not do this. In READ COMMITTED a `SELECT tokens` fixes a snapshot, and
-- both sessions can read the same last token before either writes — the lost update, which is the
-- per-process defect above rewritten as a race and reintroduced into the fix for it.
--
-- `rowCount` is the whole answer: 1 means the token was spent (the insert path always affords it,
-- because `cost <= capacity` is checked where the buckets are declared), 0 means the `WHERE` failed
-- and the caller is over quota. This mirrors 011's `ON CONFLICT DO NOTHING`, where `rowCount` is
-- likewise the claim.
--
-- # The arithmetic, and why it is all integer
--
--     earned         = floor(max(0, now - refilled_at_ms) / ms_per_token)
--     tokens'        = min(capacity, tokens + earned) - cost
--     refilled_at'   = refilled_at_ms + earned * ms_per_token
--
-- `refilled_at_ms` advances by the time that was actually converted into whole tokens, never to
-- `now`. Advancing it to `now` would throw away the remainder on every call, so a caller making
-- requests faster than `ms_per_token` would refill at nothing — a limiter that tightens the more it
-- is used, which reads as an outage rather than as a limit.
--
-- `GREATEST(0, ...)` because `now` comes from an application instance's clock and `refilled_at_ms`
-- was written by a different one. Skew makes the elapsed time negative, and integer division of a
-- negative numerator in Postgres truncates toward zero, so an unguarded expression would subtract
-- tokens for time that had not passed.
--
-- On refusal the `WHERE` fails and NOTHING is written, so the accrued time is kept for the next
-- attempt rather than being consumed by the request that was turned away.

CREATE TABLE IF NOT EXISTS agent_quotas (
  address        text    NOT NULL,
  bucket         text    NOT NULL,
  tokens         integer NOT NULL,
  refilled_at_ms bigint  NOT NULL,
  PRIMARY KEY (address, bucket)
);

-- The invariants the statement above maintains, asserted by the table rather than trusted.
--
-- A negative balance means a decrement escaped the affordability test, which is the exact failure
-- this table exists to make impossible — so it aborts here rather than being read back later as a
-- caller who owes requests. The ceiling is not checked, because capacity is per-bucket
-- configuration and lives in `lib/rate-limit.ts`; a column default here would be a second place for
-- it to be true, and the two would drift.
ALTER TABLE agent_quotas DROP CONSTRAINT IF EXISTS agent_quotas_tokens_not_negative;
ALTER TABLE agent_quotas ADD CONSTRAINT agent_quotas_tokens_not_negative CHECK (tokens >= 0);

-- The sweep's index, as 011's is.
--
-- A row may be deleted only once it is provably full, and `refilled_at_ms` is what proves it:
-- the column advances only on a successful spend, so a row untouched for longer than
-- `capacity × ms_per_token` has refilled to capacity by the arithmetic above. Deleting it and
-- recreating it full are then the same thing, and no caller is forgiven a limit that was biting.
-- Sweeping on any shorter interval WOULD forgive them, which is why the cutoff is computed from the
-- widest bucket rather than picked.
CREATE INDEX IF NOT EXISTS agent_quotas_refilled_idx ON agent_quotas (refilled_at_ms);

-- No PostgREST exposure, following 008 and 011. A role that can write this table sets its own
-- quota; a role that can delete from it has none.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_quotas FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_quotas FROM authenticated;
  END IF;
END $$;
