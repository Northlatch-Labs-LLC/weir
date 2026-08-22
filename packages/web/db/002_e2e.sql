-- Built-by: @projectx.sui /|\ · Co-authored-by: Claude
-- End-to-end encryption for direct messages.
--
-- A Sui address is a hash of a public key, so you cannot encrypt to an address. Each participant
-- therefore publishes an X25519 public key, self-certified: the registration is signed by the Sui
-- address, so the server can verify the binding without being trusted to assert it.

CREATE TABLE IF NOT EXISTS encryption_keys (
  address          text PRIMARY KEY,
  -- 32-byte X25519 public key, base64.
  x25519_public    text NOT NULL,
  registered_at_ms bigint NOT NULL
);

-- Encrypted payload. Nullable because messages sent before this migration are plaintext and stay
-- readable; `encrypted` says which a row is, so nothing has to guess from a NULL.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted boolean NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ciphertext text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS nonce text;
-- One wrapped message-key per participant: the recipient and the sender, so the sender can still
-- read what they wrote. `[{recipient, ephemeralPublic, nonce, wrappedKey}]`.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS envelopes jsonb;

-- An encrypted row must carry everything needed to decrypt it, and must not carry plaintext.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS encrypted_rows_are_complete;
ALTER TABLE messages ADD CONSTRAINT encrypted_rows_are_complete CHECK (
  NOT encrypted
  OR (ciphertext IS NOT NULL AND nonce IS NOT NULL AND envelopes IS NOT NULL
      AND body = '' AND preview = '')
);
