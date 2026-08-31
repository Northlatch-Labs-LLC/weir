-- 021_subscriber_bodies.sql — a subscriber post's body becomes ciphertext too.
--
-- 020 sealed paid bodies to `unlock_identity(vault, content_key)`. A subscriber post has no content
-- key and no `Unlock`; it is opened by `entitlement::seal_approve_subscription`, which checks a
-- `Subscription` against an identity of the form:
--
--     <vault> ‖ 0x01 ‖ <tier, u64 LE> ‖ <period index, u64 LE>
--
-- Both numbers are arguments to the Move call, so a reader must be told them. They cannot be
-- recomputed at read time and they must not be:
--
--   * `period` is `period_of(published_at)`, not `period_of(now)`. Deriving it from the clock would
--     make every post unopenable thirty days after it was written, which is a bug that arrives on
--     its own, in production, a month after the change looked fine.
--   * `tier` is what the creator published at. Today that is always 0 — every subscriber holds
--     `tier >= 0`, so tier 0 reproduces exactly what "subscribers only" means in the product now —
--     but it is stored rather than assumed, because the day a creator publishes at tier 1 the posts
--     already sealed at tier 0 must keep opening.
--
-- Both are public. Naming a tier and a period grants nothing: the key server re-executes the policy
-- with the reader as sender, and `id == period_identity(vault, tier, period)` binds the arguments to
-- the identity, so a reader who names a period they did not pay for is refused by the contract.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS body_tier   bigint;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS body_period bigint;

-- Tier and period travel together, and only alongside a sealed body.
--
-- A period without a tier cannot be turned into an identity, and a tier and period without a blob
-- describe the encryption of nothing. Both states are unrecoverable once written — the identity is
-- not stored anywhere else in a form this table can reach — so they are refused at write time
-- rather than discovered by a subscriber who paid and cannot read.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_body_period_complete;
ALTER TABLE posts ADD CONSTRAINT posts_body_period_complete CHECK (
  (body_tier IS NULL AND body_period IS NULL)
  OR (body_tier IS NOT NULL AND body_period IS NOT NULL AND body_blob_id IS NOT NULL)
);

-- Finding the subscriber posts whose words are still in the clear, as 020 does for paid ones.
CREATE INDEX IF NOT EXISTS posts_unsealed_subscriber_body_idx
  ON posts (id) WHERE access_kind = 'subscribers' AND body_blob_id IS NULL;
