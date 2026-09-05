-- Built-by: @projectx.sui · Co-authored-by: Claude
-- 017: what a creator promises the people who tip them.
--
-- # This one is a promise, and the schema should not pretend otherwise
--
-- Every other thing this platform tells a reader is enforced by a contract: an unlock opens against
-- an object in a wallet, a deposit is withdrawable because no function moves it, a fee is taken in
-- the same transaction that pays. None of that is true here.
--
-- `creator::tip` mints nothing. It settles the payment, increments a counter, and emits
-- `PaymentSettled` — so there is no object a perk could be gated on, and no Move function that
-- could enforce one. What this table holds is a creator saying "tip me this much and I will do
-- that", recorded by us. The tip is on chain and permanent; the promise is ours to display and
-- theirs to keep, and every surface that renders it says so in those words.
--
-- Writing it down anyway is the point: an audience that already tips has no way to know what, if
-- anything, it is worth. This makes the offer explicit and public instead of living in a pinned
-- post somebody has to find.
--
-- # The threshold is a lifetime total, in the vault's own unit
--
-- `PaymentSettled` carries no timestamp, so "tipped this month" is not a question the chain can
-- answer without an indexer we do not run. Lifetime total is the question it can answer, and it is
-- the kinder one: standing here only ever grows, and a supporter never loses a perk by being early.
--
-- Stored in the smallest unit of the creator's own vault coin — MIST for a SUI vault, 6-decimal
-- units for USDC — because that is the unit the event reports and the unit the contract settles in.
-- A column of "dollars" would be a conversion this table cannot do and a rate it cannot know.

CREATE TABLE IF NOT EXISTS creator_perks (
  -- Whose page this appears on. Cascade, because retiring a creator page must actually remove what
  -- it promised: a perk outliving its author is an offer nobody is left to honour.
  handle           text NOT NULL REFERENCES profiles (handle) ON DELETE CASCADE,

  -- The creator's own ordering, top to bottom. Part of the key rather than a free column so that
  -- two perks cannot claim the same slot and leave the display order to chance.
  position         smallint NOT NULL,

  -- What a supporter must have given in total, in the smallest unit of the vault's coin.
  -- Zero is allowed and means "everyone who has tipped at all", which is a real offer a creator
  -- may want to make. Negative is not: a threshold below nothing is not a threshold.
  threshold_units  bigint NOT NULL CHECK (threshold_units >= 0),

  -- The offer, in the creator's words.
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),

  -- Optional detail under it. Empty is normal — a title is often the whole offer.
  detail           text NOT NULL DEFAULT '' CHECK (length(detail) <= 400),

  PRIMARY KEY (handle, position)
);

-- Every read of this table is "the perks on this page", in the creator's order. The primary key
-- already serves it, so there is no second index here: an index nothing queries is storage and
-- write cost bought for nothing.

-- Whether this creator answers supporters first.
--
-- Opt-in, default false, and false is the honest default: it sets an expectation about a person's
-- behaviour, and nobody should have that expectation published on their behalf because a migration
-- ran. It is a statement of intent, not a filter the server enforces — messaging is open to
-- everyone with an account and this column does not change that.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS supporters_first boolean NOT NULL DEFAULT false;
