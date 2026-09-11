-- Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
-- One profile row per vault, enforced.
--
-- `profiles` is keyed by handle, but the thing a row *names* is a vault. Nothing stopped two rows
-- claiming the same `vault_id`, and when that happened the name a page showed depended on which
-- query reached it first — which is not a race anybody can win by saving again.
--
-- It was not hypothetical. An account whose on-chain handle was `testbuyer` had a row keyed
-- `reader`, left over from an earlier name. `/api/creator/profile` derives the row key from the
-- chain, correctly, so every save wrote a *new* `testbuyer` row for the same vault while the
-- `reader` row kept answering the pages the creator was looking at. Their display name and bio
-- saved perfectly, every time, into a row nothing read. Reported as a name that would not stick.
--
-- The drifted row was reconciled by hand before this ran: the row was recreated under the handle
-- the chain, the key file and the CLI keystore all agree on, its one follower repointed, and the
-- old row deleted. That repair cannot live in a migration, because deciding which of two names is
-- the real one requires reading the chain, and SQL cannot.
--
-- This is the part that generalises: after today, the second claim fails loudly at the database
-- instead of quietly producing a row nobody reads.
--
-- Partial, on purpose. `vault_id` is NULL for a registered account that has not opened a vault —
-- 006 is what made that possible — and NULLs do not collide in a unique index anyway. Writing the
-- predicate says the exemption is intended rather than incidental.

CREATE UNIQUE INDEX IF NOT EXISTS profiles_vault_id_key
  ON profiles (vault_id)
  WHERE vault_id IS NOT NULL;
