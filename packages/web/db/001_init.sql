-- Built-by: @projectx.sui · Co-authored-by: Claude
-- ProjectX Social — content schema.
--
-- What is NOT here is the point: there is no table recording who may read what. Entitlement is
-- decided by objects held on Sui, and this database has no say in it. A `may_read` column would be
-- a second source of truth for the one question the chain already answers, and the two would drift.
--
-- Addresses are stored lower-cased. Sui addresses are hex and case-insensitive, so storing them as
-- given makes `follower = $1` silently miss and turns a composite primary key into no key at all.
-- Normalising on write means comparisons are plain equality everywhere.

CREATE TABLE IF NOT EXISTS profiles (
  handle          text PRIMARY KEY,
  vault_id        text NOT NULL,
  owner           text NOT NULL,
  display_name    text NOT NULL,
  bio             text NOT NULL DEFAULT '',
  coin_type       text NOT NULL,
  stake_vault_id  text
);
CREATE INDEX IF NOT EXISTS profiles_owner_idx ON profiles (owner);

CREATE TABLE IF NOT EXISTS posts (
  id             text PRIMARY KEY,
  vault_id       text NOT NULL,
  author_handle  text NOT NULL REFERENCES profiles (handle) ON DELETE CASCADE,
  created_at_ms  bigint NOT NULL,
  title          text NOT NULL,
  preview        text NOT NULL,
  -- Withheld from clients unless entitled. Stored plainly; the gate is in the application, and
  -- there is exactly one of it.
  body           text NOT NULL,
  access_kind    text NOT NULL CHECK (access_kind IN ('public', 'subscribers', 'paid')),
  -- Smallest units, as text. NUMERIC would be safe too, but every amount in this system crosses a
  -- boundary as a decimal string and converting twice invites a float somewhere in the middle.
  price          text,
  content_key    text,
  -- A paid post is unsellable without both, because `unlock` reads the price from chain and
  -- refuses content that has none. Enforcing it here stops the store describing a state the
  -- contract will not honour.
  CONSTRAINT paid_posts_need_pricing CHECK (
    access_kind <> 'paid' OR (price IS NOT NULL AND content_key IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS posts_author_created_idx ON posts (author_handle, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at_ms DESC);

CREATE TABLE IF NOT EXISTS assets (
  id            text PRIMARY KEY,
  post_id       text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  content_type  text NOT NULL,
  bytes         bigint NOT NULL,
  label         text NOT NULL DEFAULT '',
  sha256        text NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_post_idx ON assets (post_id);

CREATE TABLE IF NOT EXISTS comments (
  id             text PRIMARY KEY,
  post_id        text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author         text NOT NULL,
  body           text NOT NULL,
  created_at_ms  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, created_at_ms);

-- Composite key rather than a surrogate: following twice is not a second follow, and the database
-- should say so rather than leaving the application to remember.
CREATE TABLE IF NOT EXISTS follows (
  follower       text NOT NULL,
  handle         text NOT NULL REFERENCES profiles (handle) ON DELETE CASCADE,
  created_at_ms  bigint NOT NULL,
  PRIMARY KEY (follower, handle)
);
CREATE INDEX IF NOT EXISTS follows_handle_idx ON follows (handle);
CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower);

CREATE TABLE IF NOT EXISTS messages (
  id             text PRIMARY KEY,
  thread_id      text NOT NULL,
  from_addr      text NOT NULL,
  to_addr        text NOT NULL,
  created_at_ms  bigint NOT NULL,
  preview        text NOT NULL,
  body           text NOT NULL,
  access_kind    text NOT NULL CHECK (access_kind IN ('open', 'paid')),
  price          text,
  content_key    text,
  vault_id       text,
  CONSTRAINT paid_messages_need_pricing CHECK (
    access_kind <> 'paid'
    OR (price IS NOT NULL AND content_key IS NOT NULL AND vault_id IS NOT NULL)
  ),
  -- A thread with yourself is not a thread.
  CONSTRAINT no_self_messages CHECK (from_addr <> to_addr)
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id, created_at_ms);
CREATE INDEX IF NOT EXISTS messages_to_idx ON messages (to_addr, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS messages_from_idx ON messages (from_addr, created_at_ms DESC);
