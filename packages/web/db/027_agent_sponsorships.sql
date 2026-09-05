-- Built-by: @projectx.sui
-- Co-authored-by: Kaela <kaela@projectxprotocol.dev>
--
-- Sponsored account creation: we pay the gas for the first N agents to claim a handle.
--
-- # Why this table exists rather than a counter in application code
--
-- The offer is "the first fifty", and that is a promise about a global limit under concurrency.
-- Two requests arriving in the same millisecond must not both see forty-nine. A count held in a
-- process is wrong the moment there are two processes, and this deployment scales out — so the
-- ceiling lives where the serialisation lives, which is Postgres.
--
-- The cap is enforced by `seat`: a small integer, unique, allocated from a bounded range. A row
-- can only exist with a seat between 1 and the cap, and two rows cannot share one. Exhausting the
-- offer is therefore a unique-violation on insert rather than a decision made after a read, and
-- there is no window between checking and acting.
--
-- # One sponsorship per address, and per handle
--
-- `address` is the primary key, so an agent cannot take two seats by asking twice. `handle` is
-- unique as well: without it, fifty seats could be spent racing for one desirable name, and the
-- forty-nine losers would each have burned a seat on a transaction that aborts on chain.
--
-- # What is deliberately NOT here
--
-- No signature, no transaction bytes, no key material, and no transaction digest.
--
-- The first three because a stored sponsored transaction is a signed cheque sitting in a database.
--
-- The digest because we would have to be told it, and a column whose only source is a claim by the
-- party it benefits records a claim rather than a fact. A seat is marked claimed by READING THE
-- CHAIN: if the handle now resolves to the address that reserved it, the registration happened,
-- and no report from anybody is needed or trusted. That also removes the need for a second
-- endpoint whose whole job would be to fill this column in.

CREATE TABLE IF NOT EXISTS agent_sponsorships (
  -- The agent's Sui address, lower-cased and zero-padded by the caller. One seat each.
  address        text     PRIMARY KEY,
  -- The handle the seat was spent claiming. Unique so two agents cannot race for one name.
  handle         text     NOT NULL UNIQUE,
  -- Which seat, 1..cap. The uniqueness of this column IS the cap.
  seat           integer  NOT NULL UNIQUE,
  -- What we expected the gas to cost, from the simulation, in MIST. Recorded so the real cost of
  -- the offer is measurable afterwards rather than estimated.
  gas_budget_mist text    NOT NULL,
  -- Set when the chain confirms the handle now belongs to this address. Null means reserved and
  -- not yet confirmed — a real state, and not the same as a completed one.
  claimed_at_ms  bigint,
  reserved_at_ms bigint   NOT NULL,

  CONSTRAINT seat_within_offer      CHECK (seat >= 1 AND seat <= 50),
  CONSTRAINT reservation_is_dated   CHECK (reserved_at_ms > 0),
  CONSTRAINT claimed_after_reserved CHECK (claimed_at_ms IS NULL OR claimed_at_ms >= reserved_at_ms),
  CONSTRAINT gas_budget_is_a_number CHECK (gas_budget_mist ~ '^[0-9]+$')
);

-- Reserved-but-unclaimed seats are swept back by the application after a timeout; this makes that
-- sweep an index scan rather than a table scan once the table has rows.
CREATE INDEX IF NOT EXISTS agent_sponsorships_unclaimed_idx
  ON agent_sponsorships (reserved_at_ms)
  WHERE claimed_at_ms IS NULL;

-- This deployment reaches Postgres as the owning role and performs every read and write
-- server-side. Managed Postgres additionally publishes tables to a public role over REST, which is
-- reachable independently of this application. A table recording who we paid for is not public.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_sponsorships FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_sponsorships FROM authenticated;
  END IF;
END $$;
