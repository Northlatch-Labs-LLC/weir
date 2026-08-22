-- Built-by: @projectx.sui /|\ · Co-authored-by: Claude
-- 012: this deployment only broadcasts transactions it built.
--
-- `checkout/submit` took `{bytes, signature}` and executed them against the configured fullnode.
-- Nothing tied the bytes to a quote this deployment had produced, and no signature over the
-- caller's identity was required — so anybody could use the platform's RPC quota, its IP
-- reputation and its gas-free relay to broadcast arbitrary Sui transactions. The route's own
-- docstring says it "deliberately cannot build a transaction", which was true and not the point:
-- it did not have to build one to send one.
--
-- Every quote-producing path now records the SHA-256 of the bytes it hands out, and `submitSigned`
-- refuses anything absent from this table.
--
-- # Why the digest and not the bytes
--
-- The bytes are large, they are already held by the caller, and storing them would make this table
-- a copy of every pending transaction on the platform. The digest answers the only question asked
-- of it — "did we issue this?" — and reveals nothing if the table leaks.
--
-- # Rows expire, and expiry is not a security property here
--
-- A quote is built against a specific gas price and specific object versions, so it stops being
-- executable on its own before long. The 30-minute window is generous enough for a person to read
-- a wallet prompt, make tea and come back, and short enough that the table stays small. A caller
-- who waits past it gets a clear refusal and a fresh quote, not a silent failure.

CREATE TABLE IF NOT EXISTS issued_quotes (
  -- SHA-256 of the base64 transaction bytes exactly as handed to the client.
  digest        bytea PRIMARY KEY,
  expires_at_ms bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS issued_quotes_expiry_idx ON issued_quotes (expires_at_ms);

-- No PostgREST exposure, following 008 and 011. A role that could insert here could authorise its
-- own transactions for relay, which is the whole thing this table prevents.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON issued_quotes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON issued_quotes FROM authenticated;
  END IF;
END $$;
