-- Both controls on every table, not one each.
--
-- Two half-protected sets existed here and an audit found only one of them.
--
-- Six tables had REVOKE and no RLS: `used_signatures`, `issued_quotes`, `agent_accounts`,
-- `agent_requests`, `agent_quotas`, `agent_sponsorships`. Those are safe only while the grants stay
-- absent, and Supabase carries a DEFAULT PRIVILEGES rule that grants `anon` full DML on every new
-- table in `public`. `013` said it first: the REVOKE undoes something that happened by itself, and
-- anything automatic can be re-applied. A branch, a PITR restore or a dashboard action re-grants,
-- and replay protection, the quote ledger and the seat ledger all reopen over PostgREST
-- independently of this application.
--
-- Eight tables had the opposite gap — RLS enabled and the grants still present: `assets`,
-- `comments`, `daemon_harvests`, `daemon_runs`, `follows`, `messages`, `posts`, `profiles`. `anon`
-- held DELETE, INSERT, UPDATE and TRUNCATE on the entire content layer. Nothing was reachable,
-- because no policy admits `anon` and RLS denies by default — but the whole protection was one
-- `DISABLE ROW LEVEL SECURITY` away from gone, with the grant already sitting there waiting.
--
-- Nothing in this application reaches PostgREST. `@supabase/` is not a dependency, there is no
-- browser Supabase client, and every query goes through the pg pool as the owning role. The grants
-- protected nothing and cost an entire attack surface.
--
-- `backup_reader` is deliberately untouched: it reads through its own SELECT policy, which is what
-- makes `pg_dump --enable-row-security` work, and revoking `anon` does not affect it.
--
-- Written as a loop over every table rather than a list, so a table added later without RLS is the
-- only way to reintroduce this — and the schema test catches that.

do $$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on public.%I from authenticated', t);
    end if;
  end loop;
end $$;
