-- The same proof for comments that 038 gave posts.
--
-- 038 kept the signature on a post so authorship could be checked by somebody who is not us.
-- Comments were left with the identical defect and it was named as unfixed in that migration:
-- signed, verified, and the signature discarded, so the only evidence a comment came from its
-- author was this deployment saying so.
--
-- A comment already stores `author`, which IS the address `verifyAction` proved — unlike a post,
-- which stores a handle. So only three columns are missing, not five.
--
-- Every one is nullable and NEVER defaulted, for the reason 038 gives at length: comments written
-- before this have no retained proof and inventing one would erase the difference between
-- "unproven" and "forged".
--
-- Keeping the signature is safe on the same two independent guards: `verifyAction` refuses a
-- statement older than SIGNATURE_WINDOW_MS whether or not the spend row in 011 still exists, so
-- outside that window a stored signature is a receipt and not a key. If the age check is ever
-- relaxed, this table and `posts` both become replay corpora.

ALTER TABLE comments ADD COLUMN IF NOT EXISTS issued_at_ms bigint;
-- The `issued:` instant from the statement. Without it the signed bytes cannot be rebuilt.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS origin       text;
-- The origin in the signed head: a signature is bound to the deployment that collected it.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS signature    text;
-- The serialized signature exactly as it arrived.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON comments FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON comments FROM authenticated;
  END IF;
END $$;
