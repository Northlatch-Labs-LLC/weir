-- 031_vault_ids_are_normalised.sql
--
-- Make `profiles.vault_id` normalised, so the lookup that reads it can use its own index.
--
-- # The query that could not use the index
--
-- `findProfileByVault` asked `WHERE lower(vault_id) = lower($1)`. `profiles_vault_id_key` (007) is
-- a plain unique index on the bare column, so a function applied to that column makes the predicate
-- non-sargable and the index unusable: every call sequentially scans `profiles`. The callers are
-- `checkout/tip`, `checkout/unlock`, `creator/profile` and `messages/read` — the money paths.
--
-- # Why the obvious fix was wrong, which is the part worth reading
--
-- The obvious fix is to drop the `lower()`, on the reasoning that addresses are normalised on
-- write. THEY ARE NOT. `upsertProfile` calls `normaliseAddress(profile.owner)` and passes
-- `profile.vaultId` RAW — so `owner` is guaranteed lower-cased and zero-padded and `vault_id` is
-- whatever the caller sent. Dropping the `lower()` on that basis would have silently stopped
-- finding any row written with different casing or without padding.
--
-- Measured before deciding: `profiles` holds 1 row, its `vault_id` is lower-case and 66 characters,
-- and no row violates the shape. So there is nothing to backfill — but a table that happens to
-- conform is not a table that must, and the writer is what makes it a rule rather than a
-- coincidence.
--
-- So the fix is in three parts and the query is the last of them: normalise on write (application),
-- enforce it here (this constraint), and only then compare the bare column.
--
-- # NOT VALID, then VALIDATE
--
-- `ADD CONSTRAINT ... CHECK` without `NOT VALID` takes `ACCESS EXCLUSIVE` and scans every row before
-- releasing it, blocking reads and writes for the duration. On one row that is instant and the
-- distinction is academic; it is written the correct way anyway, because the next person to copy
-- this file will not be copying it onto one row. `VALIDATE CONSTRAINT` takes only
-- `SHARE UPDATE EXCLUSIVE` and does the scan without blocking.
--
-- NULL is allowed and is a real state: 006 made `vault_id` nullable for a registered account that
-- has not opened a vault, and 007's index is partial for the same reason.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS vault_id_is_normalised;

ALTER TABLE profiles
  ADD CONSTRAINT vault_id_is_normalised
  CHECK (vault_id IS NULL OR vault_id ~ '^0x[0-9a-f]{64}$')
  NOT VALID;

ALTER TABLE profiles VALIDATE CONSTRAINT vault_id_is_normalised;
