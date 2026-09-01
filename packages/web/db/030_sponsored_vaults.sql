-- 030_sponsored_vaults.sql
--
-- Meter the sponsored vault opening, which was the one sponsored action nothing counted.
--
-- Numbered 030 rather than 029. Two migrations were written as 029 in parallel branches, and the
-- other one reached production's ledger first — so the number was taken on the database, not merely
-- in a branch. Filename order is the whole contract of a migration set, and a duplicate number is
-- the one thing that contract cannot survive: two files claiming one position leaves no answer to
-- "what ran, and in what order".
--
-- # What was unmetered
--
-- `POST /api/agents/sponsor` has two branches. The account branch reserves one of fifty seats, one
-- per address and one per handle, and `027` is the table that makes that cap real. The vault branch
-- checked that three fields were strings and then signed a gas payment — no seat, no signature, no
-- row, no dedup, and nothing on chain caps it either, because a creator may hold more than one
-- vault. An address could ask for a sponsored vault, sign it, and ask again.
--
-- The gas guard added earlier is correct and is not what closes this: it proves the transaction does
-- what it claims and pays only what it should. It does not limit how many times somebody may ask.
--
-- # One row per address, and the cap is a unique column
--
-- `address` is the primary key, so an address gets one sponsored vault and the database is what says
-- so. `slot` is `UNIQUE` over a bounded range, which is the same trick `027` uses for seats: the
-- uniqueness of the column IS the cap, so the ceiling cannot be exceeded by a race, a retry, or a
-- second instance. There is no count-then-insert anywhere, because a count read in one statement and
-- acted on in another is a ceiling with a gap in the middle.
--
-- # Why a per-address record is not the whole answer, stated rather than implied
--
-- Sui addresses are free. Per-address dedup stops the trivial loop — the same caller asking twice —
-- and it does not stop somebody generating fresh addresses. That is what the global cap is for, and
-- it is why both exist: the primary key bounds one caller, the unique slot bounds everybody.
--
-- # The number
--
-- Fifty, matching the account offer, because the two are the same offer seen twice: an agent takes a
-- seat to get an identity and then opens a vault with it. At the sponsored budget of 0.02 SUI a
-- vault, fifty is 1 SUI, and the account offer at roughly 0.006 SUI a seat is about another 0.3 —
-- inside the float the sponsor wallet holds, with room left over. It is a budget, not a promise, and
-- the ceiling is here so that exhausting it is a refusal rather than an empty wallet.
--
-- # No expiry, deliberately
--
-- `027` holds a seat for fifteen minutes and lets an expired hold be taken over, because reserving a
-- handle and claiming it are two steps with a person-shaped gap between them. Opening a vault is one
-- step: the row is written when the gas is signed, and there is nothing to reserve and nothing to
-- expire. A row here means it happened.

CREATE TABLE IF NOT EXISTS agent_sponsored_vaults (
  -- The agent's Sui address, lower-cased and zero-padded by the caller. One sponsored vault each.
  address         text     PRIMARY KEY,
  -- Which slot, 1..cap. The uniqueness of this column IS the cap.
  slot            integer  NOT NULL UNIQUE,
  -- What the gas was expected to cost, in MIST, so the real cost of the offer is measurable
  -- afterwards rather than estimated.
  gas_budget_mist text     NOT NULL,
  -- The vault this paid for, once the chain confirms it. Null means the gas was signed and the
  -- outcome is not yet recorded — a real state, and not the same as a completed one.
  vault_id        text,
  sponsored_at_ms bigint   NOT NULL,

  CONSTRAINT vault_slot_within_offer CHECK (slot >= 1 AND slot <= 50),
  CONSTRAINT vault_sponsorship_dated CHECK (sponsored_at_ms > 0),
  CONSTRAINT vault_gas_is_a_number   CHECK (gas_budget_mist ~ '^[0-9]+$')
);

-- Answering "how many are left" without reading every row.
CREATE INDEX IF NOT EXISTS agent_sponsored_vaults_slot_idx ON agent_sponsored_vaults (slot);

/*
  Closed to every role but the owner, by BOTH mechanisms.

  `013_read_sessions.sql` states why one is not enough: this platform carries a DEFAULT PRIVILEGES
  rule handing `anon` and `authenticated` full DML on every new table in `public`, so the REVOKE
  below undoes something that happened by itself — and anything automatic can be re-applied by a
  later restore, branch, or dashboard action, silently. RLS with no policy denies everything to those
  roles and survives that; the owning role, which is how this deployment connects, bypasses RLS and
  is closed by the REVOKE instead. Each covers the other's gap.

  Six tables in this schema carry only the REVOKE. This one does not join them.
*/
ALTER TABLE agent_sponsored_vaults ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_sponsored_vaults FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_sponsored_vaults FROM authenticated;
  END IF;
END
$$;
