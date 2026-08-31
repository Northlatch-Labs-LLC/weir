-- 020_sealed_bodies.sql — a gated post's body becomes ciphertext on Walrus.
--
-- Creator Terms §4.3 states that bodies of gated posts are encrypted client-side with Seal and
-- that Northlatch cannot read them. The Privacy Policy states it twice more. It was not true: the
-- body was a `text` column here, and two paid bodies were read out of it in one query on
-- 2026-08-31. The media beside them was genuinely sealed; the words were not.
--
-- These columns hold what a sealed body needs, mirroring `assets` exactly so the two are read the
-- same way: a Walrus blob id, the GCM nonce, the Seal-wrapped key, and the plaintext hash the
-- reader verifies after decrypting. All are public values — the nonce and the wrapped key are safe
-- to hand to anybody, because neither opens anything without a threshold of key servers first
-- executing `entitlement::seal_approve_unlock`.
--
-- `body` stays. It is NOT dropped and NOT cleared here:
--   * free and subscriber posts keep their body in it, unchanged;
--   * paid posts published before this migration keep theirs until they are migrated deliberately,
--     because silently blanking a creator's words to make a claim true would be the worse crime.
-- Nothing is deleted by this file.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS body_blob_id         text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS body_end_epoch       bigint;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS body_nonce           text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS body_seal_wrapped_key text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS body_sha256          text;

-- Either a body is sealed and every part of it is present, or none of it is.
--
-- A blob id without its nonce is a blob nobody can ever open again, and a wrapped key without a
-- blob is a key to nothing. Both states are unrecoverable once written, which is exactly the kind
-- of thing worth refusing at write time rather than discovering at read time.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_sealed_body_complete;
ALTER TABLE posts ADD CONSTRAINT posts_sealed_body_complete CHECK (
  (body_blob_id IS NULL
     AND body_nonce IS NULL AND body_seal_wrapped_key IS NULL AND body_sha256 IS NULL)
  OR (body_blob_id IS NOT NULL
     AND body_nonce IS NOT NULL AND body_seal_wrapped_key IS NOT NULL AND body_sha256 IS NOT NULL)
);

-- Finding the paid posts whose words are still in the clear, for the migration that follows.
CREATE INDEX IF NOT EXISTS posts_unsealed_paid_body_idx
  ON posts (id) WHERE access_kind = 'paid' AND body_blob_id IS NULL;
