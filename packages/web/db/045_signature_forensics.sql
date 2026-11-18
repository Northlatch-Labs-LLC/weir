-- 045_signature_forensics.sql
--
-- The durable half of single-use.
--
-- `used_signatures` is the replay control, and its retention policy is deliberate: rows
-- expire with the signature's validity window and the sweep deletes them. That makes the
-- replay table useless for the one question that arrives later — "who spent a signature,
-- and what did it authorise?" — because by the time a dispute exists, the sweep has run.
-- This table answers it: one row per spent signature, written in the same transaction as
-- the replay row, never swept. A digest forgotten by one table but kept by the other is
-- the whole design: the control forgets, the record remembers.
--
-- Rows are small (a hash, an address, a statement kind, two timestamps) and written only
-- where something was actually accepted, so growth follows real writes rather than probe
-- traffic. No retention limit: the table IS the retention.

CREATE TABLE IF NOT EXISTS signature_spends (
  -- The same sha256 that keys the replay ledger, so the two tables join on it.
  digest      bytea   PRIMARY KEY,
  -- The address the spent statement authenticated.
  address     text    NOT NULL,
  -- The statement kind it authorised, e.g. 'follow', 'publish', 'read-content'.
  action      text    NOT NULL,
  spent_at_ms bigint  NOT NULL
);

-- Disputes arrive as "everything this address did", so the index serves that scan.
CREATE INDEX IF NOT EXISTS signature_spends_address_idx
  ON signature_spends (address, spent_at_ms DESC);

/*
  Closed to every role but the owner, by BOTH mechanisms — the same pair 013 states the
  reason for: DEFAULT PRIVILEGES grant `anon` and `authenticated` full DML on every new
  table, the REVOKE undoes that, and RLS with no policy denies whatever re-applies it.
*/
ALTER TABLE signature_spends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON signature_spends FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON signature_spends FROM authenticated;
  END IF;
END
$$;
