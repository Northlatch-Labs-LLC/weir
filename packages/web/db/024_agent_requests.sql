-- Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- 024_agent_requests.sql — a machine that times out may retry without doing the thing twice.
--
-- # What was wrong, and why nobody noticed
--
-- 011 made a write signature single-use, and it was right to. `verifyAction` claims the digest with
-- `INSERT ... ON CONFLICT DO NOTHING`, and a second presentation of the same signature is refused
-- with "this signature has already been used — sign again". Against a replay attacker that is
-- exactly correct.
--
-- Nobody noticed what it does to a caller who is not an attacker, because until now every caller
-- was a person. A person whose request times out reloads the page, sees whether the post appeared,
-- and signs again if it did not. **They resolve the ambiguity with their eyes.**
--
-- A machine cannot. When a POST times out — the connection dropped, the function was frozen after
-- the commit, the load balancer gave up — the agent holds no evidence of which of two worlds it is
-- in. Retrying re-signs, so the digest is new, so the write happens again. Not retrying risks
-- having done nothing. And the *identical* refusal comes back whether the first attempt committed
-- or not, so the error message cannot tell them apart either.
--
-- That ambiguity is today unresolvable from the client, and it is what this table closes. The unit
-- of identity stops being the signature — which is single-use by design and must stay that way —
-- and becomes a key the client chooses and reuses across its own retries.
--
-- # What the columns are
--
-- `key`             the client's `Idempotency-Key` header, verbatim. The primary key, so the claim
--                   is decided by Postgres rather than by two racing reads.
-- `address`         the caller, normalised (lower-cased, zero-padded) exactly as everywhere else in
--                   this schema. Stored so a stored response can never be handed to somebody who
--                   did not make the request that produced it.
-- `route`           the path that was called. A key reused across two different routes is a client
--                   bug, and returning route A's response to a call on route B would be ours.
-- `request_sha256`  SHA-256 of the raw request body as it arrived on the wire. Not of a re-encoded
--                   object: `JSON.stringify` does not fix key order across two runs of the same
--                   client, so hashing a parsed-and-reserialised body would call a byte-identical
--                   retry a different request. The body itself is never stored — an idempotent POST
--                   body carries the same content a `posts` row does, and there is no reason to
--                   keep a second copy of it here.
-- `response_body`   what the first attempt answered, replayed verbatim to the retry. NULL means the
--                   first attempt has claimed the key and has not finished.
-- `status`          the HTTP status that went with it. NULL alongside a NULL body, never alone.
-- `created_at_ms`   when the claim was taken.
-- `expires_at_ms`   when the row stops mattering, and may be swept.
--
-- # The three answers, and why the middle one is a 409
--
--   same key, same body      → the first response, replayed. The retry is safe.
--   same key, DIFFERENT body → `409`. The client is reusing a key for a second, different
--                              operation, and there is no answer that is not a lie: replaying the
--                              first response reports success for something never done, and
--                              executing the second silently discards the key's whole purpose.
--   same key, still running  → `409`, retryable. Two of the client's own attempts are in flight.
--
-- # The key space is per address, and the reasoning that said otherwise was backwards
--
-- This table first made `key` alone the primary key, arguing that `(address, key)` "would let one
-- address probe another's key space by claiming it". **That is inverted.** With `key` alone the
-- namespace is GLOBAL and SHARED: address A claiming key `X` is precisely what makes `X`
-- unavailable to address B, so the single-column key is the thing that creates the cross-address
-- claim. With `(address, key)` a claim lives in the claimant's own namespace and cannot reach
-- anybody else's, because a row is only ever found by the pair.
--
-- The defect the old shape carried: A can pre-claim B's keys and B receives `409` on its own
-- legitimate retries — a denial of service against a mechanism whose entire job is to make retries
-- safe. The stated mitigation was that clients must choose random keys. That is a client-side
-- convention protecting a server-side invariant, which is the shape of a hole rather than a fix:
-- an adversary who observes one key, or a client with a weak generator, breaks it.
--
-- Nothing else in the design changes. The address is still compared before any stored response is
-- returned, so even within one namespace a mismatched request never yields a body it did not
-- produce; that check is now a second line rather than the only one.
--
-- # Why rows expire rather than accumulate
--
-- The same reasoning as `used_signatures`. Past `expires_at_ms` the client has long stopped
-- retrying, so the row cannot change an outcome; keeping it grows the table forever to answer a
-- settled question. The window is 24 hours rather than the signature window's ten minutes, because
-- a machine's backoff is measured in minutes and a ten-minute memory would expire underneath a
-- retry that is still legitimately in progress. Writes sweep it, as 011's do.

CREATE TABLE IF NOT EXISTS agent_requests (
  key            text     NOT NULL,
  address        text     NOT NULL,
  route          text     NOT NULL,
  request_sha256 bytea    NOT NULL,
  response_body  jsonb,
  status         smallint,
  created_at_ms  bigint   NOT NULL,
  expires_at_ms  bigint   NOT NULL,
  -- Per address, so a claim can never reach another caller's key space. See the header.
  PRIMARY KEY (address, key)
);

-- A response and its status travel together, or neither is present.
--
-- A status with no body would replay an empty answer for a request that produced one. A body with
-- no status has nothing to send it with. Both are unrecoverable once written — the first attempt is
-- gone and cannot be asked again — so they are refused at write time rather than discovered by an
-- agent that retried and got a blank.
ALTER TABLE agent_requests DROP CONSTRAINT IF EXISTS agent_requests_response_complete;
ALTER TABLE agent_requests ADD CONSTRAINT agent_requests_response_complete CHECK (
  (response_body IS NULL AND status IS NULL)
  OR (response_body IS NOT NULL AND status IS NOT NULL AND status BETWEEN 100 AND 599)
);

-- The sweep's index, as `used_signatures_expiry_idx` is for 011. Without it every write scans the
-- whole table to find what to delete, which is the shape that turns a cheap guard into the slowest
-- statement in the application.
CREATE INDEX IF NOT EXISTS agent_requests_expiry_idx ON agent_requests (expires_at_ms);

-- No PostgREST exposure, following 008 and 011.
--
-- An anonymous role that could read this table reads the response body of every idempotent write on
-- the platform. One that could delete from it removes the protection entirely, which returns every
-- machine caller to executing its retries twice.
--
-- Guarded on the roles existing, because `anon` and `authenticated` are Supabase's and a plain
-- Postgres has neither. Unguarded, this statement aborts with `role "anon" does not exist` after
-- the table and index have already been created — and a migration that half-applies is worse than
-- one that fails, because the next run sees the table present and concludes there is nothing to do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_requests FROM authenticated;
  END IF;
END $$;
