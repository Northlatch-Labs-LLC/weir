-- Built-by: @projectx.sui · Co-authored-by: Claude
-- 014: an address is not the only way to reach somebody.
--
-- # What this is for
--
-- Every action worth anything on this platform needs a Sui address: following, subscribing,
-- tipping, unlocking, claiming a handle. That is the point of the design and it is also a cliff.
-- Somebody who arrives interested but without a wallet has no action available at all — the whole
-- page asks them for something they cannot give today, so they leave and there is no way back.
--
-- This table is the way back. It is an email list, nothing more: a person who is not ready to
-- connect a wallet can still ask to be told when something ships.
--
-- # What it is NOT
--
-- It is not a waitlist for an unlaunched product. Weir is live — creators are posting, vaults are
-- staking, paid bodies are being released against on-chain objects. Nothing that reads from this
-- table may imply the product is pending.
--
-- # The email is the primary key
--
-- So a second signup for the same address is a unique violation rather than a duplicate row, which
-- lets the route answer "you are already on the list" as a distinct, calm outcome instead of either
-- silently inserting twice or reporting a failure. Lower-cased on the way in and checked here, so
-- the constraint cannot be defeated by capitalisation.
--
-- # No address column, deliberately
--
-- Joining an email to a Sui address would build exactly the record this platform exists not to
-- hold: a table mapping on-chain activity to a real-world identity. The list knows an email and
-- where the form was, and nothing else. If that link is ever wanted it should be a decision taken
-- on purpose, not something that arrived because a column was easy to add.

CREATE TABLE IF NOT EXISTS waitlist_signups (
  email         text PRIMARY KEY CHECK (email = lower(email)),
  -- Which surface the address came from. One list, several forms — worth being able to tell the
  -- hero apart from the footer without keeping two tables.
  source        text   NOT NULL,
  -- The handle they would like, without the leading @, lower-cased. Optional: this is an email list
  -- first, and requiring a handle turns a ten-second action into a naming decision.
  --
  -- It reserves NOTHING on chain and must never be presented as though it does. A handle is claimed
  -- by a transaction that mints it, and until somebody signs one it stays first-come. What this
  -- records is an intention, so the person can be told if it goes while they wait.
  handle        text   CHECK (handle IS NULL OR handle = lower(handle)),
  -- creator | supporter | both. Constrained here as well as in the route, because a CHECK is the
  -- guard that still holds when a future caller forgets the one written in TypeScript.
  role          text   NOT NULL CHECK (role IN ('creator', 'supporter', 'both')),
  created_at_ms bigint NOT NULL
);

-- Newest-first is the only order this is ever read in.
CREATE INDEX IF NOT EXISTS waitlist_signups_created_idx ON waitlist_signups (created_at_ms DESC);

-- One intention per handle, and only where one was given.
--
-- Partial, because most signups leave the handle blank. It lets the route tell somebody their
-- preferred handle is already spoken for *on the list* — a different fact from it being taken on
-- chain, and worth keeping separate, since only one of the two is binding.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_handle_idx
  ON waitlist_signups (handle) WHERE handle IS NOT NULL;

-- No PostgREST exposure, following 008, 011 and 013.
--
-- This one matters more than its contents suggest. The table is a list of email addresses belonging
-- to people interested in a platform about money, which is a phishing list — an anonymous SELECT
-- here is a data breach even though nothing in it is secret. And an anonymous INSERT would let
-- anybody fill it with addresses that never consented, which turns the first announcement into
-- unsolicited mail sent by us.
--
-- Guarded on the roles existing, because `anon` and `authenticated` are Supabase's and a plain
-- Postgres has neither. Unguarded, this aborts with `role "anon" does not exist` after the table
-- has already been created — and a migration that half-applies is worse than one that fails,
-- because the next run sees the table present and concludes there is nothing left to do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON waitlist_signups FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON waitlist_signups FROM authenticated;
  END IF;
END $$;

-- And RLS on top of the revoke, for the reason spelled out in 013: Supabase carries a DEFAULT
-- PRIVILEGES rule handing `anon` and `authenticated` full DML on every new table in `public`, so
-- the REVOKE above undoes something that happened by itself — and anything automatic can be
-- re-applied by a later restore, branch or dashboard action, silently. RLS is a property of the
-- table rather than of a grant somebody has to remember to strip again.
--
-- No policies, deliberately: RLS with no policy denies everything, and no PostgREST caller should
-- ever reach this table. The application connects as the owning role, which bypasses RLS.
ALTER TABLE waitlist_signups ENABLE ROW LEVEL SECURITY;
