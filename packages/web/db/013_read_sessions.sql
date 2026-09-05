-- Built-by: @projectx.sui · Co-authored-by: Claude
-- 013: a reader's identity is proved once, then carried by a cookie.
--
-- # What was wrong
--
-- Entitlement was resolved for whatever address the URL named. `?reader=0x…` is a claim, and the
-- server treated it as an identity: anyone could enumerate buyers from public chain events, name
-- one, and be served the post bodies, the paid comments and the decrypted media that buyer had paid
-- for. The blob encryption did not help, because this server holds the key and decrypts before
-- responding.
--
-- # Why a cookie rather than a signature on each request
--
-- Media is fetched by `<img src>`, which cannot carry a POST body, so the proof has to travel in
-- something a browser attaches by itself. The two candidates were a signature in the query string
-- and a cookie.
--
-- The query string loses. `Shell.withReader` appends `?reader=` to every link in the frame, so a
-- signature placed there would be copied into chats and pasted into issue trackers by people simply
-- sharing a page — publishing their own credential. It would also land in access logs and in
-- `Referer` headers. A cookie is attached by the browser, never rendered, and never shared by
-- accident.
--
-- # Why the token is stored as a digest
--
-- The row holds `sha256(token)`, never the token. Anybody who reads this table learns which
-- sessions exist and can impersonate none of them — the same reasoning as `used_signatures` in 011.
--
-- # What a session grants, and what it does not
--
-- Exactly one thing: the right to be *asked about*. `readEntitlements(address)` still goes to the
-- chain, and `canRead` still decides from objects that address genuinely owns. A stolen session
-- reads what its owner already could; it cannot unlock, cannot spend, and cannot write. Every write
-- path continues to require a fresh single-use signature through `verifyAction`.

CREATE TABLE IF NOT EXISTS read_sessions (
  -- SHA-256 of the session token. The token itself is never stored: it is the bearer secret.
  digest        bytea PRIMARY KEY,
  -- The address this session speaks for, proved by a signature at mint time. Lower-cased and
  -- 0x-prefixed by `normaliseAddress`, so it compares the way every other address column does.
  address       text   NOT NULL,
  -- When the session stops being honoured. Checked on read as well as swept, so an unswept row can
  -- never grant anything: the sweep is an optimisation, never the guard.
  expires_at_ms bigint NOT NULL,
  created_at_ms bigint NOT NULL
);

-- The sweep's index, and the same reasoning as 011: without it every mint scans the whole table to
-- find what to delete, turning a cheap guard into the slowest statement in the application.
CREATE INDEX IF NOT EXISTS read_sessions_expiry_idx ON read_sessions (expires_at_ms);

-- Revoking every session an address holds — on sign-out, or if one is ever suspected stolen — is a
-- delete by address, and without this it is a sequential scan.
CREATE INDEX IF NOT EXISTS read_sessions_address_idx ON read_sessions (address);

-- No PostgREST exposure, following 008 and 011. This table is only ever touched by the
-- application's own pooled connection. An anonymous role that could read it learns nothing usable
-- — the tokens are not here — but one that could *insert* into it could mint itself a session for
-- any address on the platform, which is the whole vulnerability this migration exists to close,
-- re-opened one layer down.
--
-- Guarded on the roles existing, because `anon` and `authenticated` are Supabase's and a plain
-- Postgres has neither. Unguarded, this aborts with `role "anon" does not exist` after the table
-- has already been created — and a migration that half-applies is worse than one that fails,
-- because the next run sees the table present and concludes there is nothing left to do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON read_sessions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON read_sessions FROM authenticated;
  END IF;
END $$;

-- And row-level security on top of the revoke, which is belt *and* braces on purpose.
--
-- Two things justify the redundancy. The first is what this table is: a row here amounts to a
-- bearer credential, so an anonymous INSERT would mint a session for any address on the platform —
-- the whole vulnerability this migration closes, rebuilt one layer down and reachable over the
-- public REST API rather than through the application.
--
-- The second is how the grant appears in the first place. Nobody granted it: Supabase carries a
-- DEFAULT PRIVILEGES rule handing `anon` and `authenticated` full DML on every new table in
-- `public`, which is why every content table in this database shows DELETE/INSERT/UPDATE for both
-- roles. The REVOKE above therefore undoes something that happened by itself — and anything
-- automatic can be re-applied by a later restore, branch, or dashboard action, silently. RLS is the
-- guard that survives that, being a property of the table rather than of a grant somebody has to
-- remember to strip again.
--
-- No policies are attached, deliberately. RLS with no policy denies everything, which is exactly
-- right here: no PostgREST caller should ever read or write this table. The application reaches it
-- as the owning role, which bypasses RLS — the same way it already reads `posts` and `profiles`,
-- both of which have carried RLS with zero policies since they were created.
ALTER TABLE read_sessions ENABLE ROW LEVEL SECURITY;
