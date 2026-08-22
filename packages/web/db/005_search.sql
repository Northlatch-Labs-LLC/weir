-- Built-by: @projectx.sui /|\ · Co-authored-by: Claude
-- Search indexes.
--
-- # Why trigram and not a btree
--
-- Discovery matches substrings: someone typing "ladder" should find "The staking ladder", not only
-- titles that begin with it. `ILIKE '%ladder%'` cannot use a btree index at all — Postgres scans
-- every row — which is invisible with three creators and is the thing that breaks at thirty
-- thousand. GIN over trigrams indexes the substrings themselves and is what makes the same query
-- answerable without a scan.
--
-- # Why not full-text search
--
-- `to_tsvector` stems and drops stopwords, which is right for prose and wrong for this: handles are
-- identifiers, not words. Searching "sui" should find `@suiladder`, and a stemmer will not do that
-- because it is looking for word boundaries that a handle does not have.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Creators: matched on handle, display name and bio.
CREATE INDEX IF NOT EXISTS profiles_handle_trgm ON profiles USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_name_trgm   ON profiles USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_bio_trgm    ON profiles USING gin (bio gin_trgm_ops);

-- Posts: title and preview only.
--
-- NOT `body`. A paid post's body is withheld from anyone without an entitlement, and indexing it
-- for search would let somebody find — and confirm the contents of — writing they have not bought,
-- one query at a time. The preview is what the creator chose to show regardless, so it is the
-- correct thing to match on and the only thing that stays correct when the gate is working.
CREATE INDEX IF NOT EXISTS posts_title_trgm   ON posts USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS posts_preview_trgm ON posts USING gin (preview gin_trgm_ops);
