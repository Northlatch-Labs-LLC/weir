-- Every failure the product knows about, in one place, so an outage is a query rather than a memory.
--
-- The site had no error capture of any kind: failures became a console line in a log nobody reads
-- and the client got an opaque sentence. This table is the smallest thing that turns that around.

CREATE TABLE IF NOT EXISTS error_events (
  id          BIGSERIAL PRIMARY KEY,
  at_ms       BIGINT      NOT NULL,
  source      TEXT        NOT NULL,
  detail      TEXT        NOT NULL,
  route       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reads are always "recent first".
CREATE INDEX IF NOT EXISTS error_events_at_idx ON error_events (at_ms DESC);
CREATE INDEX IF NOT EXISTS error_events_source_idx ON error_events (source, at_ms DESC);

-- Nothing here is meant to be permanent. A year of detail is plenty and the table must not grow
-- without a bound.
COMMENT ON TABLE error_events IS 'Application failures. Prune rows older than 365 days.';

-- Closed the same way 029 closes every other table: RLS on, and the grants removed where the roles
-- exist. The application connects as the owner, so it still writes; nothing anonymous reads this, and
-- there is no policy that would admit it.
--
-- The role check is not decoration. Supabase has anon and authenticated; the Postgres that CI starts
-- has neither, and an unguarded REVOKE there fails the migration outright with "role anon does not
-- exist" — which is exactly how this landed red the first time.
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

do $guard$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.error_events from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.error_events from authenticated';
  end if;
end $guard$;
