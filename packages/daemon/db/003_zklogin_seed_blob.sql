-- C-01 migration: add encrypted seed blob column
-- Run BEFORE deploying the registration patch.
-- Safe to run with zero downtime (additive only).

-- Step 1: add new column (nullable to avoid locking full table)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zklogin_seed_blob TEXT;

-- Step 2: after backfill is confirmed, drop or nullify old column
-- ⚠️  DO NOT run Step 2 until every existing user has been migrated
--     or you have confirmed there are no existing rows with raw seeds.
-- ALTER TABLE users DROP COLUMN zklogin_seed;

-- Step 3 (optional): add index for faster lookup if you query by blob presence
CREATE INDEX IF NOT EXISTS idx_users_zklogin_blob_notnull
  ON users (id)
  WHERE zklogin_seed_blob IS NOT NULL;

-- Backfill note:
--   Existing users with raw seeds in zklogin_seed cannot be backfilled
--   server-side (we don't store their recovery phrase). Trigger a
--   forced re-onboarding flow for affected users: on next login,
--   prompt them to set a recovery phrase, then call encryptSeed()
--   and write zklogin_seed_blob. Only then null-out zklogin_seed.
