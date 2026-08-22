-- Built-by: @projectx.sui /|\ · Co-authored-by: Claude
-- 015: whether the front door is open.
--
-- # What this is for
--
-- # Why this is a table and not the chain
--
-- Every economic rule in this product is a Move contract, deliberately, and none of that changes
-- here. This is not an economic rule — it is whether a web server serves a page. Putting it on
-- chain would mean a signed transaction and an epoch of latency to close a marketing page, and it
-- would say something untrue about where the protocol's authority lives: the contracts do not care
-- whether this website is up.
--
-- What *is* chain-derived is who may flip it. See `lib/site-admin.ts`: the authority is ownership of
-- the package's `Publisher` object, read from chain on every write. There is no role column here,
-- and adding one would be a second answer to a question the chain already settles.
--
-- # One row, enforced
--
-- `CHECK (id = 1)` plus a primary key means the table can hold exactly one row. A settings table
-- that can hold two has a reader somewhere picking one of them, and which one it picks is a
-- function of insertion order nobody wrote down.

CREATE TABLE IF NOT EXISTS site_mode (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- The switch. Default false: a deployment that has never been configured is open, because the
  -- alternative is a fresh install that serves nobody anything and looks broken.
  waitlist_mode boolean NOT NULL DEFAULT false,

  -- The Sui address that last changed it, lower-cased. Kept for the same reason the deployment
  -- record keeps custody: when somebody asks "why is the site closed", the answer should not be a
  -- shrug. Nullable because the seeded row was set by nobody.
  updated_by text,

  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The single row. `ON CONFLICT DO NOTHING` so re-running this migration never resets a live
-- setting back to open — a migration that silently re-opens a closed site is worse than one that
-- fails loudly.
INSERT INTO site_mode (id, waitlist_mode) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

/*
  Row-level security, matching the posture of every other table here.

  The Data API must not reach this. Reading it is harmless — whether the site is open is obvious
  from visiting it — but *writing* it must go through the route that checks the chain, and a table
  reachable by an anon key is a switch anybody can flip. Revoked outright rather than policied:
  nothing in this application talks to Postgres as `anon`, so there is no policy worth writing.
*/
ALTER TABLE site_mode ENABLE ROW LEVEL SECURITY;

-- Guarded on the roles existing, because `anon` and `authenticated` are Supabase's and a plain
-- Postgres has neither. Unguarded this aborts with `role "anon" does not exist` *after* the table
-- is created, which leaves a local database holding a table whose grants were never applied while
-- the migration reports failure — the worst of both. Same guard as `014_waitlist.sql`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON site_mode FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON site_mode FROM authenticated;
  END IF;
END
$$;
