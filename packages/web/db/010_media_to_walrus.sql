-- Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
-- Media moves off local disk and onto Walrus.
--
-- The disk it lived on was per-instance and discarded with the instance, so an upload landed on a
-- container that then vanished and no other instance could read it. There was no working blob
-- storage in this product at all.
--
-- Four columns, all nullable, and the nullability carries meaning rather than uncertainty:
--
--   blob_id    the Walrus blob. Null only for rows written before this migration, which have no
--              retrievable bytes anywhere and are dead regardless.
--   end_epoch  the epoch after which Walrus deletes the blob unless the lease is extended. Storage
--              is a lease, never permanence, and a column that cannot express expiry would make
--              every renewal decision guesswork.
--   enc_key    null means the blob is public plaintext.
--   enc_nonce  present exactly when enc_key is.
--
-- A free post's bytes go up unencrypted on purpose. Anyone can then read them from any aggregator
-- without this platform's involvement, which is the property the product argues for everywhere
-- else: the content outlives us. A paid post's bytes are encrypted before they leave, because a
-- Walrus blob is public and plaintext there does not weaken the paywall, it removes it.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS blob_id   text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS end_epoch bigint;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS enc_key   text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS enc_nonce text;

-- Either both halves of the encryption are present, or neither is. A key without its nonce opens
-- nothing, and a row in that state is a blob nobody can ever read again — worth refusing at write
-- time rather than discovering when a buyer asks for what they paid for.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_encryption_complete;
ALTER TABLE assets ADD CONSTRAINT assets_encryption_complete
  CHECK ((enc_key IS NULL) = (enc_nonce IS NULL));

-- Finding what expires next, for the renewal path. Partial: rows without a lease are not candidates.
CREATE INDEX IF NOT EXISTS assets_end_epoch_idx ON assets (end_epoch) WHERE end_epoch IS NOT NULL;
