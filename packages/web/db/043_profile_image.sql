-- Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
-- 043: a face on every profile.
--
-- One nullable column: the Walrus blob id of the picture a creator chose for their page. The
-- bytes live on Walrus, not here; this row only says which blob is theirs, and `/api/avatar/<id>`
-- serves a blob only when some profile names it, so the site never becomes a proxy for arbitrary
-- blobs. Nothing is backfilled: a profile without a picture keeps the mark drawn from its address,
-- which is what every profile has shown until now.
--
-- Additive. No row changes, no default, nothing dropped.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS image_blob_id text;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS image_blob_id_is_a_walrus_id;
ALTER TABLE profiles
  ADD CONSTRAINT image_blob_id_is_a_walrus_id
  CHECK (image_blob_id IS NULL OR image_blob_id ~ '^[A-Za-z0-9_-]{43}$')
  NOT VALID;
ALTER TABLE profiles VALIDATE CONSTRAINT image_blob_id_is_a_walrus_id;

CREATE INDEX IF NOT EXISTS profiles_image_blob_id_idx ON profiles (image_blob_id) WHERE image_blob_id IS NOT NULL;
