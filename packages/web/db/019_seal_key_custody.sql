-- Built-by: @projectx.sui · Co-authored-by: Claude
-- The key moves to Seal. The bytes do not move at all.
--
-- Until now a gated asset's AES-256-GCM key sat in `enc_key`, in this database, next to the row it
-- opens. `lib/blob-crypto.ts` has always said what that means in plain words: **we can decrypt a
-- creator's paid media**. On-chain entitlement decided whether we released it; it did not enforce
-- the release. Our own Creator Terms §4.3 tell creators otherwise, and closing that gap is what
-- this migration is for.
--
-- # What changes, and what deliberately does not
--
-- Nothing stored on Walrus is touched. Not one blob is re-uploaded, re-encrypted or re-addressed.
-- The ciphertext stays byte-identical, still AES-256-GCM, still opened by the same 32-byte key
-- under the same 12-byte nonce. What changes is who can produce that key:
--
--   before  enc_key           = the key, base64, held by us
--   after   seal_wrapped_key  = the same key, encrypted to a Seal identity the contract derives,
--                               reconstructable only by a threshold of key servers that first
--                               execute `entitlement::seal_approve_*` against the reader's own
--                               `Unlock` or `Subscription`
--
-- This is envelope encryption, and it is the shape `blob-crypto.ts` was written for: "The migration
-- is designed to move the key, not the bytes... the key is opaque 32 bytes with no structure of
-- ours in it." Thirty-two opaque bytes are exactly what Seal can carry. Sealing the blob itself
-- instead would mean re-encrypting and re-uploading every asset — paying for the storage twice,
-- changing every blob id, and putting the only copy of a creator's media through a network round
-- trip to save a layer that costs nothing.
--
-- # enc_nonce stays, and its staying is not an oversight
--
-- The nonce is not secret and never was. It is needed to open the blob whichever custodian holds
-- the key, so it survives the migration untouched. Only `enc_key` is surrendered.
--
-- # Why the scheme is a column and not an inference
--
-- Both schemes must coexist while assets are migrated, and the difference between them is not
-- guessable from the other columns without relying on a coincidence — "enc_key is null but
-- enc_nonce is not" happens to identify a sealed row today, and would silently misread the first
-- row that ever ends up in an unexpected state. A reader that guesses wrong either serves
-- ciphertext as an image or asks a key server for a key that was never issued. So the row says
-- which, explicitly, and the CHECK below makes every other combination unrepresentable.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS enc_scheme       text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS seal_wrapped_key text;

-- Backfill before the constraint, or the constraint refuses the table it is being added to.
--
-- Every encrypted row that exists at this moment is by definition platform-custody: `seal` did not
-- exist until this migration. Rows with no key are public plaintext and keep a NULL scheme, which
-- is the same "not encrypted" that a NULL enc_key has always meant.
UPDATE assets SET enc_scheme = 'platform' WHERE enc_key IS NOT NULL AND enc_scheme IS NULL;

-- The old constraint said "a key and its nonce arrive together". That was right when there was one
-- custodian and is wrong now: a sealed row has a nonce and deliberately has no enc_key. Replaced
-- rather than loosened — dropping it without a successor would allow the half-written rows it was
-- added to prevent.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_encryption_complete;

-- One constraint, three legal shapes, nothing else representable.
--
--   NULL       public plaintext blob. No key, no nonce, no wrapped key.
--   'platform' we hold the key. enc_key and enc_nonce present, seal_wrapped_key absent.
--   'seal'     Seal holds the key. enc_nonce and seal_wrapped_key present, enc_key ABSENT.
--
-- `enc_key IS NULL` under 'seal' is the load-bearing clause in this whole file. It is what makes
-- "Northlatch cannot read them" a property of the schema rather than a promise in a document: a row
-- that kept its plaintext key while claiming to be sealed would satisfy every reader in the
-- application and quietly preserve our ability to decrypt. The database refuses to store it.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_encryption_scheme;
ALTER TABLE assets ADD CONSTRAINT assets_encryption_scheme CHECK (
  (enc_scheme IS NULL
     AND enc_key IS NULL AND enc_nonce IS NULL AND seal_wrapped_key IS NULL)
  OR (enc_scheme = 'platform'
     AND enc_key IS NOT NULL AND enc_nonce IS NOT NULL AND seal_wrapped_key IS NULL)
  OR (enc_scheme = 'seal'
     AND enc_key IS NULL AND enc_nonce IS NOT NULL AND seal_wrapped_key IS NOT NULL)
);

-- Finding what still needs migrating, and proving when nothing does.
--
-- Partial, because the answer this index exists to give is "which rows are still platform-custody",
-- and once the migration is complete it indexes nothing and costs nothing. A count of zero here is
-- the evidence that the promise in §4.3 is true of every stored asset rather than of new ones only.
CREATE INDEX IF NOT EXISTS assets_platform_custody_idx
  ON assets (id) WHERE enc_scheme = 'platform';
