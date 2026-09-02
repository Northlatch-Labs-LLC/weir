-- Keep the proof that a post was signed, so authorship can be checked by somebody who is not us.
--
-- # The gap this closes
--
-- Every write here is signed and verified, and then the signature is thrown away: 011 stores only a
-- SHA-256 digest of it, because that table exists to spend signatures rather than to keep them, and
-- the `posts` row from 001 carries no signature at all. The consequence is that after the write,
-- the ONLY evidence a post was ever signed by its author is that we say so. A reader cannot check
-- it. A court could not check it. We cannot check it either, which is the part worth saying out
-- loud: we had a cryptographic proof in our hands for one request and then deleted it.
--
-- Stated publicly under our own name on 2026-09-02. This is the fix for the posts half of it;
-- comments are the same defect and are not addressed here.
--
-- # Why keeping the signature is safe
--
-- 011's comment calls a signature "the reusable secret", and against replay that is exactly right
-- for the ten minutes it is live. After that it is inert, and not because of that table: a
-- statement carries its own `issued:` instant, and `verifyAction` refuses anything older than
-- SIGNATURE_WINDOW_MS (ten minutes) whether or not the spend row still exists. So the window where
-- a stored signature could be replayed is the same window in which 011 already holds it as spent.
-- Outside that window it is a receipt, not a key.
--
-- The two guards are independent and both are required. If the age check is ever relaxed, this
-- table becomes a replay corpus, and that is the thing to remember when relaxing it.
--
-- # Why every column is nullable
--
-- Posts published before this migration have no retained proof and never will. A default here would
-- manufacture one. Null means "we did not keep it", the route says exactly that, and a reader can
-- tell the difference between an unproven post and a forged one — which is the whole point.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_address  text;
-- The signer. Distinct from author_handle: a handle is a registry lookup that can be re-pointed,
-- an address is what actually signed. Verification needs the address, not the name.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS issued_at_ms    bigint;
-- The `issued:` instant from the statement. Without it the bytes cannot be rebuilt, and a
-- signature over bytes nobody can rebuild proves nothing.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS origin          text;
-- The origin in the signed head. A signature is bound to the deployment that collected it.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_sha256  text;
-- Stored rather than recomputed. For a paid post the body is withheld from an unentitled reader,
-- so a verifier who cannot read the text cannot derive this - and a verifier who must buy the post
-- before checking who wrote it is not a verifier.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS signature       text;
-- The serialized signature exactly as it arrived, base64 with the flag byte and public key inside.

-- No PostgREST exposure, following 008 and 011. These columns are served by one route that decides
-- what a reader may see; an anonymous role reading the table directly bypasses that decision.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON posts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON posts FROM authenticated;
  END IF;
END $$;
