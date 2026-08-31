-- Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- Close `creator_perks` to the public role.
--
-- # What was found
--
-- Measured on the production database, 2026-08-31, by reading `pg_class.relrowsecurity` against
-- `information_schema.role_table_grants` for the `anon` and `authenticated` roles:
--
--   creator_perks   rls off   anon/authenticated hold DELETE, INSERT, SELECT, TRIGGER,
--                             TRUNCATE, UPDATE, REFERENCES
--
-- It is the only table in the schema in that state. Managed Postgres publishes tables to those
-- roles over a REST interface reachable independently of this application, so anyone holding the
-- project's anon key could read this table, write rows into it, and truncate it.
--
-- The table holds no rows today, so nothing has leaked. The writable half is the part that matters:
-- perks are shown to readers as things a creator offers, and a row nobody at this desk wrote would
-- be displayed as though they had.
--
-- # Why it happened, which is the part worth keeping
--
-- `008_close_postgrest_exposure.sql` closed exactly six tables — the six that existed when it was
-- written. Every table added afterwards had to remember the rule on its own. Most did:
-- `read_sessions`, `site_mode`, `waitlist_signups`, `access_codes` and `access_passes` all carry
-- it, and `023` to `025` revoke the grants explicitly. `used_signatures` and `issued_quotes` have
-- no grants either. `creator_perks`, added by `017`, is the one that did not.
--
-- A rule enforced by remembering is a rule with a hole in it per table added. That is the finding,
-- not this one table.
--
-- # Both mechanisms, deliberately
--
-- RLS with no policy denies the public role everything while the owning role — which is how this
-- deployment connects — bypasses it entirely. Revoking the grants closes the same door from the
-- other side. `access_codes` and `read_sessions` already carry both, and matching them means this
-- table is closed even if one mechanism is later undone by a tool that "fixes" the other.
--
-- Adding a policy to this table re-opens it to the public role. Do not add one to silence a tool
-- reporting "RLS enabled with no policies" — as `008` says in the same words, that report describes
-- the intent.

ALTER TABLE public.creator_perks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.creator_perks FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.creator_perks FROM authenticated;
  END IF;
END $$;
