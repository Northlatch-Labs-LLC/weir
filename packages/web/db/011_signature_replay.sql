-- Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
-- 011: a write signature may be spent exactly once.
--
-- `verifyAction` proved that an address signed a statement, and that the statement was recent. It
-- did not prove the statement had not been used already. Freshness is not single-use: a captured
-- request could be resubmitted for the whole ten-minute window, producing N posts, N messages or N
-- follows from one signature. Post and comment ids are derived from `Date.now()`, so only a
-- same-millisecond collision was stopped, and that by the primary key rather than by design.
--
-- This table is the ledger of what has been spent. One row per signature, holding no signature —
-- only its SHA-256 — so a leak of this table reveals nothing that could be replayed anywhere.
--
-- # Why rows expire rather than accumulate
--
-- A signature older than SIGNATURE_WINDOW_MS is already refused on age, so its row can never
-- change an outcome. Keeping it would grow the table forever to answer a question that is settled.
-- `expires_at_ms` is the timestamp past which the row is dead weight, and writes sweep it.
--
-- # Reads WERE deliberately not single-use, and that was wrong
--
-- The original note read: "The `read` action proves identity for fetching a thread or a
-- notification list. Spending it would demand a wallet prompt per refresh, which trains people to
-- approve prompts without reading them — a worse outcome than the replay it would prevent, since
-- replaying a read grants exactly the access the signer already had."
--
-- The last clause is true of the SIGNER and false of an INTERCEPTOR, and the argument was reasoned
-- entirely from one of the two parties. The same bytes in somebody else's hands return that
-- address's inbox — thread list, message bodies, notification feed — for the whole ten minutes the
-- statement stays fresh. It grants the attacker what the signer had; it grants the signer nothing
-- new. That is the blind spot, and it is recorded here rather than only in a commit because the
-- argument above is persuasive and the next reader deserves to meet its limit at the same time.
--
-- The cost it was avoiding was also not being paid. `Notifications.load()` and both read paths in
-- `Messages.tsx` sign on every call and cache nothing, and `load()` is bound to a button rather
-- than a timer, so no client here has ever reused a read signature. Making reads single-use costs
-- zero additional prompts. It does mean a retried POST fails the second time — the same behaviour
-- every write already has.
--
-- Reads are now spent like everything else. `isSingleUse` returns true for every kind.

CREATE TABLE IF NOT EXISTS used_signatures (
  -- SHA-256 of the signature. The signature itself is never stored: it is the reusable secret, and
  -- this table exists precisely to stop it being reused.
  digest        bytea PRIMARY KEY,
  -- When this row stops mattering. Past it the signature fails the age check regardless.
  expires_at_ms bigint NOT NULL
);

-- The sweep's index. Without it every write scans the whole table to find what to delete, which is
-- the shape that turns a cheap guard into the slowest statement in the application.
CREATE INDEX IF NOT EXISTS used_signatures_expiry_idx ON used_signatures (expires_at_ms);

-- No PostgREST exposure, following 008. This table is only ever touched by the application's own
-- pooled connection: an anonymous role that could read it learns which signatures exist, and one
-- that could delete from it removes replay protection entirely.
--
-- Guarded on the roles existing, because `anon` and `authenticated` are Supabase's and a plain
-- Postgres has neither. Unguarded, this statement aborts with `role "anon" does not exist` — which
-- is what it did against the local database, after the table and index had already been created.
-- A migration that half-applies is worse than one that fails, because the next run sees the table
-- present and concludes there is nothing to do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON used_signatures FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON used_signatures FROM authenticated;
  END IF;
END $$;
