-- Built-by: @projectx.sui /|\ · Co-authored-by: Claude
-- The encryption key registry moved to Sui. This table is not a cache of it; it is deleted.
--
-- Keeping it would create a second source of truth for the question "which key writes to this
-- address", and the two would drift. That is the exact failure this schema's own documentation
-- describes about access control, and the reason there has never been a `may_read` column: a
-- database row and a chain object that disagree is worse than either alone, because the
-- disagreement is silent and the client cannot tell which one it is being served.
--
-- Nothing is lost that cannot be republished: an X25519 key is derived from a wallet signature, so
-- every user can reproduce theirs and publish it on chain. What they lose is the ability to read
-- messages sent to a key they can no longer prove ownership of — which is not affected by this
-- table existing or not.

DROP TABLE IF EXISTS encryption_keys;
