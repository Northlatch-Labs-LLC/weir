-- 034_machine_bodies.sql — a paid post's words, sealed a second time for machine buyers.
--
-- A post can be sold twice on one vault: once under its content key, once under the derived key
-- `<key>#machine` (`lib/machine-pricing.ts`). Pricing the second key has been possible since the
-- composer gained the machine block; SEALING to it never happened. `POST /api/posts` sealed one
-- body to `unlock_identity(vault, key)` only, so a machine buyer held a valid `Unlock` for an
-- identity nothing was ever encrypted to — paid, and received nothing.
--
-- From this migration on the publish route seals every paid body twice, and the second edition is
-- recorded here: six columns, the exact shape of the `body_*` six in 020, plus the key it was
-- sealed under so a reader is never asked to re-derive it.
--
-- # All six or none, and only on a sealed paid post
--
-- Half a machine body is worse than none: a blob id without its wrapped key is a spinner over
-- ciphertext that can never open, and a machine body on a subscriber post describes an identity
-- no `Unlock` can ever match (machines subscribe like people; subscriber bodies are period-sealed).
-- `body_blob_id IS NOT NULL` is required too: a machine edition of words that were never sealed
-- for humans is not a state the route can produce, and refusing it here keeps every other writer
-- honest.
--
-- # NOT VALID, then VALIDATE — 032's reasoning, unchanged
--
-- Every existing row has all six NULL, so the VALIDATE has nothing to reject; the two-statement
-- form is kept so that a growing table never pays for a check with an exclusive lock.
--
-- # No backfill, and none possible
--
-- The platform holds no plaintext after publish (`addPost` writes '' for a sealed body), so a
-- paid post published before this migration can never gain a machine edition. Those rows stay
-- human-only for ever; the partial index below is the set, and `studio/price` refuses to price a
-- machine edition for any post in it — the creator republishes instead. Nothing here is deleted
-- or updated.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS machine_blob_id          text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS machine_end_epoch        bigint;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS machine_nonce            text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS machine_seal_wrapped_key text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS machine_sha256           text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS machine_content_key      text;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_machine_body_complete;
ALTER TABLE posts
  ADD CONSTRAINT posts_machine_body_complete
  CHECK (
    (
      machine_blob_id IS NULL AND machine_end_epoch IS NULL AND machine_nonce IS NULL
      AND machine_seal_wrapped_key IS NULL AND machine_sha256 IS NULL AND machine_content_key IS NULL
    )
    OR (
      machine_blob_id IS NOT NULL AND machine_end_epoch IS NOT NULL AND machine_nonce IS NOT NULL
      AND machine_seal_wrapped_key IS NOT NULL AND machine_sha256 IS NOT NULL
      AND machine_content_key IS NOT NULL
      AND access_kind = 'paid' AND body_blob_id IS NOT NULL
    )
  ) NOT VALID;
ALTER TABLE posts VALIDATE CONSTRAINT posts_machine_body_complete;

-- The pre-034 set: paid, sealed for humans, never sealed for machines. Read by the pricing guard
-- and by scripts/report-machine-bodies.mjs; it shrinks only as creators republish.
CREATE INDEX IF NOT EXISTS posts_paid_without_machine_body_idx
  ON posts (id) WHERE access_kind = 'paid' AND body_blob_id IS NOT NULL AND machine_blob_id IS NULL;
