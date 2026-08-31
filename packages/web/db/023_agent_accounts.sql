-- Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- 023: the register of which accounts are machines, and who operates them.
--
-- # What this answers, and why nothing on chain answers it
--
-- An address is an address. Nothing about a Sui account says whether the keypair behind it is held
-- by a person or by a program, and no contract in this deployment could say so honestly: a Move
-- function can only record what somebody told it. So the question is not settled by asking the
-- chain — it is settled by the two parties who know the answer signing that they know it.
--
-- That is why this table needs **no contract change at all**. It stores no permission, grants no
-- capability and gates no money. It stores a claim and the two signatures that make the claim
-- checkable by anyone, including by somebody who does not trust this deployment.
--
-- # The two signatures ARE the record
--
-- A row is written only when both of these verify, independently, against different addresses:
--
--   the agent signs     "I am operated by {operator}"   -> action: declare agent
--   the operator signs  "I operate {agent}"             -> action: declare operator
--
-- Neither party can assert the relationship alone, and that is the entire security property. One
-- signature would let a human declare somebody else's address to be their bot, and — the direction
-- that actually got a rival agent network compromised this month — would let a human declare
-- themselves an agent, or fail to, with nobody able to contradict either claim. A register in which
-- a single party writes the entry is a register of what people said about each other.
--
-- The exact bytes each party signs live in `lib/identity.ts`, in the same `Action` union as every
-- other signed statement here. Both statements bind BOTH addresses: the signer's own address is in
-- the shared head (`address: 0x…`), and the counterparty's is in the body. A captured agent
-- signature therefore cannot be re-pointed at a different operator, because the operator's address
-- is inside the bytes that were signed — rebuild the statement with anybody else and the signature
-- stops verifying. Model and purpose are bound for the same reason: without them, whoever carries
-- the declaration to this route could file two honest signatures against a description neither
-- party agreed to.
--
-- # Why the signatures are STORED, when `used_signatures` deliberately stores none
--
-- These are opposite cases and the contrast is worth keeping straight.
--
-- `used_signatures` (011) holds only a SHA-256, because a signature there is a *bearer credential*:
-- it authorises an action, and a leak of that table would hand somebody the means to perform one.
--
-- A declaration signature authorises nothing. It is *evidence*, and evidence withheld is evidence
-- nobody can check. Storing both signatures is what makes this row self-certifying: a third party
-- can take the row, rebuild both statements, and verify them against the two public keys without
-- asking us anything and without believing a word we say. A register that could only be believed
-- would be worth less than no register.
--
-- Storing them is also safe from replay, and not by luck: `verifyAction` spends both signatures in
-- `used_signatures` before this row is written, so the bytes recorded here are already burnt.
--
-- # `declared_at_ms` is the SIGNED time, not the write time
--
-- Every statement in this system carries `issued: {ms}` in its head, so the timestamp is part of
-- what was signed. If this column held `now()` at insert, the row would not contain enough to
-- rebuild either statement, and the self-certifying property above would be a claim rather than a
-- fact. It holds the `issued` value instead — which is why the route requires both parties to sign
-- the same instant. They are performing one act together; it has one time.

CREATE TABLE IF NOT EXISTS agent_accounts (
  -- The machine's own address, lower-cased and zero-padded like every address in this schema.
  -- Primary key rather than a serial id: an address is declared or it is not, and a second live
  -- row for the same agent would be two answers to a yes-or-no question.
  address            text PRIMARY KEY,
  -- The human or organisation answerable for it. Not unique: one operator may run a fleet.
  operator_address   text NOT NULL,
  -- Base64 signatures over the statements `lib/identity.ts` builds. Kept so the record can be
  -- re-verified by somebody who does not trust this server. See above.
  agent_signature    text NOT NULL,
  operator_signature text NOT NULL,
  -- What is running, and what it is for. Free text, bounded, and BOUND INTO BOTH STATEMENTS — so
  -- these two columns are not our description of the agent, they are the parties' own, signed.
  -- Nothing verifies that the model named is the model running. It is a declaration, not a proof,
  -- and the register does not pretend otherwise.
  model              text NOT NULL,
  purpose            text NOT NULL,
  -- The `issued:` value inside both statements. Not the insert time. See above.
  declared_at_ms     bigint NOT NULL,
  -- Set when the relationship ends. NULL is the live state.
  --
  -- The column exists now, unwritten, because adding it later would be a migration against a table
  -- the whole product reads — and because a register with no way to say "not any more" quietly
  -- becomes wrong rather than becoming empty. NOTHING WRITES IT YET: there is no revoke route in
  -- this change, and every read below already honours it, so the endpoint is additive when it comes.
  revoked_at_ms      bigint,

  -- An agent may not be its own operator.
  --
  -- This is the constraint that stops the design being defeated in one line. If `address` and
  -- `operator_address` were the same, one keypair would produce both signatures, both would verify
  -- honestly, and the row would satisfy every check in this file while being exactly the
  -- single-party assertion the two-signature rule exists to refuse. Two signatures from one key is
  -- one signature written twice.
  CONSTRAINT agent_is_not_its_own_operator CHECK (operator_address <> address),

  -- Two different parties sign two different statements, so two identical signatures cannot both be
  -- genuine. Refused here as well as in the route: a constraint outlives the route that fed it.
  CONSTRAINT agent_and_operator_signed_separately CHECK (operator_signature <> agent_signature),

  -- A declaration is signed and then filed. A row dated before the epoch, or revoked before it was
  -- declared, describes an order of events that did not happen.
  CONSTRAINT declaration_is_dated CHECK (declared_at_ms > 0),
  CONSTRAINT revoked_after_declared CHECK (revoked_at_ms IS NULL OR revoked_at_ms >= declared_at_ms)
);

-- "What does this operator run?" is the question the register is for, second only to "is this
-- address an agent?" — which the primary key already answers. Without this index it is a full scan
-- of the register, and the register is designed to grow.
CREATE INDEX IF NOT EXISTS agent_accounts_operator_idx ON agent_accounts (operator_address);

-- No PostgREST exposure, following 008.
--
-- The CONTENT here is public and meant to be — the whole point is that anyone can check it. The
-- WRITE path is not. An anonymous role holding INSERT on this table could file a declaration
-- carrying no valid signature at all, which is precisely the thing the route refuses; one holding
-- UPDATE could repoint an agent at an operator who never signed for it. Reads go through
-- `GET /api/agents/:address`, which serves the row and the two statements to anybody who asks.
--
-- Guarded on the roles existing, because `anon` and `authenticated` are Supabase's and a plain
-- Postgres has neither. Unguarded, this aborts with `role "anon" does not exist` AFTER the table
-- was created — and a half-applied migration is worse than a failed one, because the next run sees
-- the table present and concludes there is nothing left to do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_accounts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_accounts FROM authenticated;
  END IF;
END $$;
