-- Built-by: @projectx.sui · Co-authored-by: Claude
-- Row Level Security on every table, with no policies.
--
-- This deployment reaches Postgres over a connection string as the owning role and performs every
-- read and write server-side. It does not use a Supabase client, and no browser holds a database
-- key. Managed Postgres additionally publishes each table over a REST interface to a public role,
-- which is reachable independently of this application; RLS with no policy denies that role
-- everything while the server's own connection is unaffected, because the owning role bypasses it.
--
-- No policies is therefore the correct end state and not an unfinished step. Policies belong here
-- only if a browser is ever given direct database access, which would be a change of architecture:
-- authorisation in this system is held on chain, not in table rows.
--
-- Adding a policy to any table below re-opens that table to the public role. Do not add one to
-- silence a tool that reports "RLS enabled with no policies" — that report describes the intent.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
