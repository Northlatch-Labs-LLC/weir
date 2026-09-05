-- Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- 036: the agent's mind — one row per remembered blob, ciphertext on Walrus, envelope here.
--
-- # What a row is
--
-- An agent encrypted its whole state to its own registered X25519 key (one envelope, its own) and
-- signed a `remember` statement over the ciphertext's SHA-256 and length. The platform verified the
-- signature, paid the WAL, stored the ciphertext on Walrus with the agent as the Blob object's owner,
-- and wrote this row so the agent can find its newest blob under a label without keeping an index.
--
-- The row holds NOTHING the platform could open: `envelope` is the wrapped message key, openable
-- only by the X25519 secret the agent derives from its own signature. `sha256` is of the ciphertext
-- and is what the statement bound; a reader verifies the bytes an aggregator serves against it.
--
-- # Every version is kept
--
-- A second remember under the same label is a new row, never an update. The newest is served; the
-- older ones are the agent's history and are never deleted here (the estate's rule: archive, never
-- delete). Walrus deletes the BLOB when its lease ends — `end_epoch` — and the row then points at
-- nothing, which `recall` reports as not-found rather than as an empty mind.
--
-- # Both controls, named, because 029's sweep ran before this table existed.

CREATE TABLE IF NOT EXISTS agent_minds (
  address       text    NOT NULL,
  label         text    NOT NULL,
  blob_id       text    NOT NULL,
  -- The Walrus epoch after which the blob is gone. A lease, not permanence.
  end_epoch     integer NOT NULL,
  -- SHA-256 of the ciphertext, hex. What the remember statement bound.
  sha256        text    NOT NULL,
  -- Ciphertext length. What the platform paid for.
  bytes         integer NOT NULL,
  -- The payload nonce and the one envelope, base64 fields as `e2e.ts` produces them.
  nonce         text    NOT NULL,
  envelope      jsonb   NOT NULL,
  created_at_ms bigint  NOT NULL,

  PRIMARY KEY (address, label, created_at_ms),
  CONSTRAINT agent_minds_bytes_positive CHECK (bytes > 0),
  CONSTRAINT agent_minds_sha256_is_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT agent_minds_label_is_short CHECK (label ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
);

-- The recall read: newest row for an address and a label.
CREATE INDEX IF NOT EXISTS agent_minds_newest_idx ON agent_minds (address, label, created_at_ms DESC);

ALTER TABLE agent_minds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_minds FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_minds FROM authenticated;
  END IF;
END
$$;
