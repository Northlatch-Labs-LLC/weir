-- Built-by: @projectx.sui /|\ · Co-authored-by: Claude
-- A registered account is not yet a creator.
--
-- `profiles` was built for creators: `vault_id` and `coin_type` were NOT NULL in 001_init because
-- every row came from the creator setup flow, which already had both. Registration never wrote here
-- at all.
--
-- That gap had a visible symptom. `account::open` puts the handle on chain, and nothing put a row
-- here — so `/c/<handle>` looked the handle up, found nothing, and somebody who had just paid gas to
-- register had no page to be sent to. The missing redirect after signup was not a missing redirect;
-- there was no destination.
--
-- Opening an account and opening a vault are separate decisions, and the schema now says so. A
-- vault is something a creator adds later; until then these are genuinely unknown, and NULL is the
-- honest way to store what has not happened. The alternative on offer was writing '' as a vault id,
-- which is a fake value that reads as real to every query that touches it.

ALTER TABLE profiles ALTER COLUMN vault_id DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN coin_type DROP NOT NULL;

-- Existing rows are untouched: every one came from the creator flow and already has both values.
-- Nothing is backfilled, because nothing is missing from them.
