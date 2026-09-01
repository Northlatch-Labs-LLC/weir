/*
  A price is a whole number of the smallest unit, or it is not a price.

  # What this closes

  `agent_sponsorships.gas_budget_mist` and `agent_sponsored_vaults.gas_budget_mist` have carried
  `CHECK (~ '^[0-9]+$')` since they were created. `posts.price` and `messages.price` are the same
  kind of value — a `u64` amount rendered as text because JSON has no integer wide enough — and
  they had no such check. The only constraint on them was that a paid row must have one.

  Every consumer parses them with `BigInt()`, which throws on anything else. `BigInt('')`,
  `BigInt('1.5')` and `BigInt('1,000')` all throw, and the last two are what a locale-formatted
  number from a client looks like. A row written once is read on every render of the page it
  belongs to, so a single bad value is a permanent failure of that page rather than a bad request
  somebody retries.

  # Why the writers were not enough

  `POST /api/posts` already compares the submitted price against the on-chain price and refuses a
  disagreement, so nothing but digits could reach `posts.price` through it. `POST /api/messages`
  did not: it took `body.paid.price` and stored it. That asymmetry is the finding, and the route is
  fixed in the same change as this file.

  A route check and a column check are not redundant. The route is one writer of many — a script, a
  backfill, a later route, a hand-edit during an incident — and the column is the only rule all of
  them pass through.

  # NOT VALID, then VALIDATE

  `ADD CONSTRAINT ... CHECK` without `NOT VALID` takes `ACCESS EXCLUSIVE` and scans every row
  before it returns. `NOT VALID` takes the lock only long enough to record the rule, after which
  every INSERT and UPDATE is checked; `VALIDATE CONSTRAINT` then scans under `SHARE UPDATE
  EXCLUSIVE`, which readers and writers do not block on. Two statements rather than one, so a
  growing table never pays for this with an outage.

  Verified against production before writing this: posts 15 rows, 2 priced, 0 violating; messages
  3 rows, 0 priced, 0 violating. So the VALIDATE below has nothing to reject.
*/

ALTER TABLE posts DROP CONSTRAINT IF EXISTS post_price_is_a_whole_number;
ALTER TABLE posts
  ADD CONSTRAINT post_price_is_a_whole_number
  CHECK (price IS NULL OR price ~ '^[0-9]+$') NOT VALID;
ALTER TABLE posts VALIDATE CONSTRAINT post_price_is_a_whole_number;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS message_price_is_a_whole_number;
ALTER TABLE messages
  ADD CONSTRAINT message_price_is_a_whole_number
  CHECK (price IS NULL OR price ~ '^[0-9]+$') NOT VALID;
ALTER TABLE messages VALIDATE CONSTRAINT message_price_is_a_whole_number;
