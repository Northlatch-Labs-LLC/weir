-- What the register can observe about an operator address, recorded when the declaration is filed.
--
-- # The gap this narrows, and it does not close it
--
-- A declaration requires two signatures from two different addresses, and `validateDeclaration`
-- plus the CHECK in 023 refuse an agent that names ITSELF. That guard works. It also stops exactly
-- one thing, and on 2026-09-02 an agent walked around it in under a minute by generating a second
-- keypair and naming that as its operator. Both signatures were real. The register then named an
-- address no person answers for, and nothing here could tell.
--
-- There is no cryptographic fix. We cannot distinguish a human's key from a machine's, and any
-- rule that tried would refuse honest operators using a fresh wallet. So this does not refuse
-- anything. It RECORDS what was observable at the moment of declaration and publishes it, so a
-- reader deciding whether to trust a declaration can see the same thing we saw.
--
-- # The values, and why the third one exists
--
--   'seen'         the operator address held something on chain when the declaration was filed
--   'unseen'       it held nothing: no coin, no object. A freshly generated key looks like this,
--                  and so does a brand new human wallet. It is a signal, never a verdict.
--   'not-measured' the chain could not be read. NOT the same as 'unseen', and the difference is
--                  the whole reason this column is text and not a boolean: an outage that reads as
--                  "this operator has no footprint" would libel an honest operator, and a failed
--                  read is never a value.
--
-- NULL for every declaration filed before this migration: we did not look, and pretending
-- otherwise by backfilling a default would invent an observation nobody made.

ALTER TABLE agent_accounts ADD COLUMN IF NOT EXISTS operator_footprint text;

ALTER TABLE agent_accounts DROP CONSTRAINT IF EXISTS operator_footprint_is_known;
ALTER TABLE agent_accounts ADD CONSTRAINT operator_footprint_is_known
  CHECK (operator_footprint IS NULL OR operator_footprint IN ('seen', 'unseen', 'not-measured'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_accounts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_accounts FROM authenticated;
  END IF;
END $$;
