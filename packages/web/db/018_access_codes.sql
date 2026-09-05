-- Built-by: @projectx.sui · Co-authored-by: Claude
-- 018: access codes — a way through the front door while it is closed.
--
-- # What this is
--
-- A code is minted at `/admin` by the Publisher, carries a label, a number of uses and an optional
-- expiry, and can be revoked. Redeeming it sets a cookie — a *pass* — that `proxy.ts` honours.
-- Revoking the code invalidates every pass it issued, because the pass row joins back to it.
--
-- # What this is not
--
-- Not an authorisation boundary, exactly as the switch is not. A pass decides whether the web
-- server serves the product or the waiting list; every page beyond still resolves entitlement from
-- objects on chain. Nothing here may ever be consulted to decide who can read a paid body.

CREATE TABLE IF NOT EXISTS access_codes (
  -- Upper-case, dash-grouped, drawn from an alphabet without 0/O/1/I. The shape is enforced here
  -- as well as in the minting code, so a row written by hand cannot be one the redeemer never
  -- matches.
  code           text PRIMARY KEY CHECK (code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  label          text NOT NULL DEFAULT '' CHECK (length(label) <= 80),
  max_uses       integer NOT NULL CHECK (max_uses >= 1 AND max_uses <= 10000),
  uses           integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  -- Null is "does not expire". Compared at redemption, never trusted to a sweep.
  expires_at_ms  bigint,
  created_by     text NOT NULL,
  created_at_ms  bigint NOT NULL,
  revoked_at_ms  bigint
);

CREATE TABLE IF NOT EXISTS access_passes (
  -- sha-256 of the cookie value, as `read_sessions` stores its tokens. A dump of this table
  -- grants nothing.
  digest         bytea PRIMARY KEY,
  code           text NOT NULL REFERENCES access_codes (code) ON DELETE CASCADE,
  created_at_ms  bigint NOT NULL,
  expires_at_ms  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS access_passes_code_idx ON access_passes (code);

-- Server-side tables. On Supabase the default privileges hand anon/authenticated full DML on every
-- new table in `public`; local Postgres has no such roles, so the revoke is conditional.
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_passes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON access_codes, access_passes FROM anon, authenticated;
  END IF;
END $$;
