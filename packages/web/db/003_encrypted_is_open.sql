-- Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
-- Encrypted messages cannot be paid messages.
--
-- A paid message works because the server withholds `body` until the buyer holds an Unlock object
-- on chain. An encrypted message ships its recipient's key envelope in the same row, so there is
-- nothing left for the server to withhold — charging for it would charge for something already
-- given away.
--
-- `app/api/messages/route.ts` refuses the combination, and this constraint is why that refusal
-- cannot be undone by a future code path that forgets. The rule belongs where the data is.

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS encrypted_messages_are_not_paid;

ALTER TABLE messages
  ADD CONSTRAINT encrypted_messages_are_not_paid CHECK (
    NOT encrypted OR access_kind = 'open'
  );

-- Serving a key registry lookup for a handful of addresses should not scan the table. The primary
-- key already covers `address = ANY(...)`, so nothing further is needed here — noted so the next
-- reader does not add a redundant index looking for one.
