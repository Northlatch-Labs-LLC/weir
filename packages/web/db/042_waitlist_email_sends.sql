-- Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
-- 042: what was sent to the waiting list, so it cannot be sent twice.
--
-- # Why a table and not a log line
--
-- On 2026-08-30 one prospect received the same outreach card twice, eight minutes apart, because
-- the sender had nothing that remembered the first attempt: a request appeared to fail, and the
-- honest response to an apparent failure — try again — sent a second copy. A file of log lines does
-- not prevent that, because nothing consults it before writing the next one.
--
-- A primary key does. `scripts/send-waitlist-email.mjs` inserts the row BEFORE it calls the
-- provider, and a conflict on that insert is the whole duplicate guard: the second attempt does not
-- reach the provider at all, on any machine, in any process, however the first one ended.
--
-- # The row is claimed before the send, and that is deliberate
--
-- The consequence is that a send which failed on the wire leaves a claimed row with
-- `provider_message_id IS NULL`, and the script will then refuse to try that address again. That is
-- the correct refusal and not a defect to code around: after a failed attempt nobody knows whether
-- a message was created, and the standing rule is to ask the provider rather than to guess. An
-- operator who has asked, and been told nothing was created, deletes that one row by hand and runs
-- the script again — `docs/waitlist-email.md` has the exact steps. Automating that deletion would
-- be automating the guess.
--
-- # The address stays here after the person leaves the list
--
-- `016` says an unsubscribe must actually remove the `waitlist_signups` row, and it does. This row
-- is not removed with it, and the reason is that the two tables record different things: one is who
-- may be written to, and the other is what was already written. A message that has been delivered
-- cannot be un-delivered, and forgetting that it was sent would let the same message go out again
-- to somebody who has since rejoined — which is the one outcome the table exists to prevent.
--
-- No new consent lives here. Nothing reads this table to decide whether somebody may be written to;
-- that question is answered by `waitlist_signups` having a row at all.

CREATE TABLE IF NOT EXISTS waitlist_email_sends (
  -- The recipient, as it was addressed. Lower-cased on the same rule as `waitlist_signups.email`,
  -- and checked here too, so a differently-capitalised second attempt is a conflict rather than a
  -- second row — which is exactly the case the guard has to catch.
  email               text   NOT NULL CHECK (email = lower(email)),
  -- Which message. Named by the template's own `id` field rather than by its filename, so renaming
  -- or moving the file cannot let the same message be sent a second time.
  template_id         text   NOT NULL,
  -- When the row was claimed, which is the moment before the provider was called.
  claimed_at_ms       bigint NOT NULL,
  -- The provider's id for the message, written after it answered. NULL means the attempt did not
  -- come back with one, and is the state an operator must resolve against the provider by hand.
  provider_message_id text,
  -- When the provider's answer was recorded. NULL alongside a NULL id; both are written together.
  sent_at_ms          bigint,
  -- One message, one recipient, once. This is the guard; everything else in the file is bookkeeping.
  PRIMARY KEY (email, template_id),
  -- Both or neither: an id with no time, or a time with no id, is a half-written record of a send
  -- and would be read as a completed one by anybody counting ids.
  CONSTRAINT waitlist_email_sends_answer_complete
    CHECK ((provider_message_id IS NULL) = (sent_at_ms IS NULL))
);

-- "What went out under this template, and did every one of them come back with an id" is the only
-- question asked of this table that is not keyed on a single address.
CREATE INDEX IF NOT EXISTS waitlist_email_sends_template_idx
  ON waitlist_email_sends (template_id, claimed_at_ms DESC);

-- No PostgREST exposure, on the reasoning `014` gives for `waitlist_signups` and `029` applies to
-- every table: this is a list of email addresses belonging to people interested in a platform about
-- money, which is a phishing list whether it is read from the list itself or from the record of what
-- was mailed to it. Guarded on the roles existing, because `anon` and `authenticated` are Supabase's
-- and a plain Postgres has neither — unguarded, this aborts after the table is already created, and
-- a migration that half-applies is worse than one that fails.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON waitlist_email_sends FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON waitlist_email_sends FROM authenticated;
  END IF;
END $$;

-- RLS on top of the revoke, for the reason `013` and `029` spell out: Supabase's DEFAULT PRIVILEGES
-- hand `anon` and `authenticated` full DML on every new table in `public`, so the REVOKE above
-- undoes something that happened by itself and could be re-applied silently by a restore, a branch
-- or a dashboard action. RLS is a property of the table rather than of a grant somebody has to
-- remember to strip again. No policies, deliberately: RLS with no policy denies everything, and the
-- application connects as the owning role, which bypasses it.
ALTER TABLE waitlist_email_sends ENABLE ROW LEVEL SECURITY;
