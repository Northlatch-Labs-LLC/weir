-- 022_subscriber_media.sql — a subscriber post's media stops being a public file.
--
-- # What was wrong, and why nobody wrote it
--
-- `studio/upload` decided encryption with `const gated = post.access.kind === 'paid'`. That line is
-- older than this storage layer. It was written when media lived on `/app/media`, a private Docker
-- volume served by a route that checked entitlement — the arrangement `docker-compose.yml` in the
-- retired ProjectX Social tree still describes. There, "not encrypted" meant "only our server can
-- read it", which was true and was fine.
--
-- Storage then moved to Walrus. **A Walrus blob is public.** The line did not change, so a
-- subscriber-only image went from being a private file to being a public one with no edit to mark
-- the moment and nothing in any diff to review. The asset ids and blob id are withheld from readers
-- who are not entitled, but that is obscurity of a location, not protection of the bytes.
--
-- # What these columns are
--
-- Subscriber media is now sealed to `period_identity(vault, tier, period)` — the same identity its
-- post's words use, so one `Subscription` opens the picture and the sentence under it, and no Move
-- change is needed because `seal_approve_subscription` is already deployed.
--
-- The Move call takes `tier` and `period` as arguments, so the row has to carry them. They live on
-- the asset rather than being read from its post because an asset must be self-describing: a
-- subscriber post published before sealing has plaintext words and no period recorded anywhere, and
-- its media should still be openable rather than depending on a column that post never got.
--
-- Both are public. Naming a tier and a period grants nothing — the key server re-executes the
-- policy with the reader as sender, and `id == period_identity(vault, tier, period)` binds the
-- arguments to the identity, so a reader who names a period they did not pay for is refused by the
-- contract rather than by us.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS seal_tier   bigint;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS seal_period bigint;

-- Tier and period travel together, and only on a Seal-sealed row.
--
-- A period without a tier cannot be turned into an identity. Either on a `platform`-custody row is
-- meaningless — that key is in this database, and no threshold committee is involved in opening it.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_seal_period_complete;
ALTER TABLE assets ADD CONSTRAINT assets_seal_period_complete CHECK (
  (seal_tier IS NULL AND seal_period IS NULL)
  OR (seal_tier IS NOT NULL AND seal_period IS NOT NULL AND enc_scheme = 'seal')
);

-- The media still lying in the clear behind a subscription, for the sweep that follows.
--
-- Nothing here rewrites those rows. Re-sealing existing blobs means downloading, encrypting and
-- re-uploading each one under a fresh lease, which is a bulk rewrite of live content and does not
-- belong in the same change as the write path that stops creating more of them.
CREATE INDEX IF NOT EXISTS assets_unsealed_subscriber_idx
  ON assets (post_id) WHERE enc_scheme IS NULL;
