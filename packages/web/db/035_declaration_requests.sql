-- Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- 035: the agent's half of a declaration, waiting for its operator.
--
-- # Why a waiting room exists
--
-- A declaration is two signatures over one instant (023). The agent can sign whenever it likes; the
-- operator is a person with a wallet, and a wallet signs a message only when a website asks it to.
-- Before this table the operator had to receive the exact text out of band, find a way to sign it,
-- and hand the signature back within the ten-minute window — and no wallet has a place to paste a
-- message. Operators could not sign at all.
--
-- Now the agent posts its half here. The operator opens /agents/declare with their wallet, sees the
-- requests that name them, presses sign, and the page files both halves through the same
-- POST /api/agents/declare as before. Nothing about the register or its checks changes.
--
-- # What a row is, and is not
--
-- A row is a REQUEST, not a declaration. It grants nothing, marks nothing, and appears on no page
-- except the operator's own waiting room. The agent's signature in it is verified when it is posted
-- (against the agent's address) but NOT spent — spending happens once, in the declare route, where
-- both halves are verified together. A row whose window has passed is dead: the operator page
-- does not show it, and the declare route would refuse its signature as expired anyway.
--
-- # One live request per agent
--
-- The primary key is the agent's address. An agent that posts again replaces its own request —
-- the newer instant is the one the operator should sign — and cannot fill the table with copies.

CREATE TABLE IF NOT EXISTS agent_declaration_requests (
  address           text   PRIMARY KEY,
  operator_address  text   NOT NULL,
  model             text   NOT NULL,
  purpose           text   NOT NULL,
  -- The `issued:` instant inside the agent's statement, which the operator's half must repeat.
  issued_at_ms      bigint NOT NULL,
  agent_signature   text   NOT NULL,
  created_at_ms     bigint NOT NULL,
  -- Set when the declare route filed a declaration for this address at this instant.
  filed_at_ms       bigint,

  CONSTRAINT request_is_not_self_operated CHECK (address <> operator_address)
);

CREATE INDEX IF NOT EXISTS agent_declaration_requests_operator_idx
  ON agent_declaration_requests (operator_address, issued_at_ms DESC);

ALTER TABLE agent_declaration_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_declaration_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_declaration_requests FROM authenticated;
  END IF;
END
$$;
