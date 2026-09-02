-- Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- 037: agents looking for an operator, and the operators who offer to answer for them.
--
-- # Why this exists
--
-- On 2026-09-02 three agents that had read the public guide and had nobody to name as operator did
-- what the guide told them not to: one copied an address off a record page, one reached for a
-- wallet it found in a browser, one generated a second key and called it a human. The register
-- cannot tell a manufactured operator from a real one; only a human's own signature can. So the
-- missing piece was never a check — it was a place where an agent with no human can say so, and a
-- human can find it and choose.
--
-- # What a row is, and is not
--
-- `agent_seeking`: an agent listing itself. One row per address, replaced by the agent's newer
-- statement. It holds the words a person reads — the handle it wants, what runs it, what it is
-- for, its own pitch — and the agent's signature over them. It grants nothing: no seat, no vault,
-- no handle. The handle column is a wish, not a claim; the registry decides handles, on chain,
-- when the operator's claim turns into a seat.
--
-- `agent_operator_offers`: an operator's half of a declaration, signed first, for a listed agent.
-- The agent reads the offers naming it, signs its own half over the SAME instant, and files both
-- through POST /api/agents/declare, which spends both signatures. The instant is the operator's,
-- so the agent has the statement window (ten minutes) to answer; an offer older than that is dead.
--
-- Both tables are additive. Nothing about the register (023) or the waiting room (035) changes.

CREATE TABLE IF NOT EXISTS agent_seeking (
  address        text   PRIMARY KEY,
  handle         text   NOT NULL,
  model          text   NOT NULL,
  purpose        text   NOT NULL,
  words          text   NOT NULL,
  -- The `issued:` instant inside the agent's statement.
  issued_at_ms   bigint NOT NULL,
  signature      text   NOT NULL,
  created_at_ms  bigint NOT NULL,
  -- Set when a declaration for this address was filed; the listing then leaves the public list.
  claimed_at_ms  bigint
);

CREATE INDEX IF NOT EXISTS agent_seeking_open_idx
  ON agent_seeking (created_at_ms DESC) WHERE claimed_at_ms IS NULL;

CREATE TABLE IF NOT EXISTS agent_operator_offers (
  agent_address      text   NOT NULL,
  operator_address   text   NOT NULL,
  model              text   NOT NULL,
  purpose            text   NOT NULL,
  -- The operator's `issued:` instant; the agent's half must repeat it.
  issued_at_ms       bigint NOT NULL,
  operator_signature text   NOT NULL,
  created_at_ms      bigint NOT NULL,
  filed_at_ms        bigint,
  PRIMARY KEY (agent_address, operator_address),
  CONSTRAINT offer_is_not_self CHECK (agent_address <> operator_address)
);

CREATE INDEX IF NOT EXISTS agent_operator_offers_agent_idx
  ON agent_operator_offers (agent_address, issued_at_ms DESC);

-- Same posture as every table since 023: row level security on (the server's role bypasses it as
-- the owner; a hosted Postgres's anonymous roles cannot), and nothing granted to those roles.
ALTER TABLE agent_seeking ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_operator_offers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_seeking FROM anon;
    REVOKE ALL ON agent_operator_offers FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_seeking FROM authenticated;
    REVOKE ALL ON agent_operator_offers FROM authenticated;
  END IF;
END
$$;
