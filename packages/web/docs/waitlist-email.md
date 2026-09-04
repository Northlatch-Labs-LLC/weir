# Sending to the waiting list

What exists in the code, and what has to be true outside it before a single message goes out.
Nothing in this branch has sent anything, and nothing in it can send anything on its own.

## What the code does now

| Piece | Where | What it is |
|---|---|---|
| The token | `lib/email-token.ts` | HMAC-SHA256 over one address under the purpose `weir.waitlist.unsubscribe.v1`. Unforgeable without the secret, single-purpose, no expiry. Also builds the `List-Unsubscribe` / `List-Unsubscribe-Post` header pair (RFC 8058). |
| The way out | `app/unsubscribe/route.ts` | `GET` and `POST` at `/unsubscribe?token=…`. Verifies, deletes the `waitlist_signups` row, answers a plain page. Idempotent; answers identically whether or not the address was on the list; refuses an unsigned token before touching Postgres. |
| The delete | `lib/waitlist-unsubscribe.ts` | One statement, keyed on the address, returning nothing. |
| The door | `proxy.ts`, `app/sitemap.ts` | `/unsubscribe` is exempt from the waiting-list gate, and deliberately absent from the sitemap. |
| The sender | `lib/email-sender.ts` | One POST to `https://api.resend.com/emails`, from `Weir <hello@weir.social>`, reply-to `hello@weir.social`. Refuses a template whose bodies do not carry `{{unsubscribe_url}}`. Has a dry run that renders without sending and needs no key. |
| The record | `db/042_waitlist_email_sends.sql`, `lib/waitlist-email-log.ts` | One row per address per template, claimed **before** the provider is called. The primary key is the duplicate guard. |
| The command | `scripts/send-waitlist-email.mjs` | Dry run by default. Sends only with `--really-send` **and** `WEIR_EMAIL_SEND_APPROVED=1`. |

## The two environment variables

Only the names are written down anywhere in this repository. Neither value is in it, and neither is
read or printed by anything that logs.

| Name | Where it must be set | What happens without it |
|---|---|---|
| `WEIR_EMAIL_TOKEN_SECRET` | **Both** the web deployment (the route verifies) and wherever the script runs (the script mints). At least 32 characters. | The route answers 503 and says it could not act; the script refuses to run at all. |
| `RESEND_API_KEY` | Only wherever the script runs. It is never needed by the web app, which does not send. | The dry run still works. A real send refuses before calling anything. |

**They must be the same value in both places.** A link minted under one secret and verified under
another is a link that tells a reader their unsubscribe is invalid. Add both names to `.env.example`
alongside the others.

## Before a real send — the operator's hand, in order

### 1. Verify `weir.social` as a sending domain in Resend

No sending domain for `weir.social` is verified anywhere on record; `projectxprotocol.dev` is, and
that is a different brand and must stay one. Adding the domain in the Resend dashboard produces the
exact values; the record shapes below are from Resend's own Cloudflare guide
(`https://resend.com/docs/dashboard/domains/cloudflare`, read 2026-09-04). The region in the two
hostnames follows the region the domain is created in, and the DKIM key is generated per domain —
copy all of them out of the dashboard rather than from here.

| # | Type | Name | Value | Priority | Required |
|---|---|---|---|---|---|
| 1 | `MX` | `send` | `feedback-smtp.<region>.amazonses.com` — the exact host Resend shows | `10` | yes |
| 2 | `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | — | yes |
| 3 | `TXT` | `resend._domainkey` | `p=<the key Resend generates>` | — | yes |
| 4 | `MX` | `inbound` | `inbound-smtp.<region>.amazonaws.com` | `10` | no — only for receiving through Resend, which we do not do |

Two things to check while in the zone:

- **Cloudflare proxying is off for all of them.** DNS-only. A proxied record is not a mail record.
- **Records 1 and 2 sit on the `send` subdomain, not the apex.** `weir.social` already carries
  Cloudflare Email Routing for `dmca@`, and Email Routing owns the apex `MX`. The subdomain is why
  the two do not collide — confirm that is still the shape of the zone before adding anything.

A DMARC record is not part of Resend's verification and is worth having anyway; Resend documents it
separately. `v=DMARC1; p=none; rua=…` on `_dmarc` is the observe-only starting point, and it is a
decision rather than a step, so it is named here and not taken.

### 2. Route `hello@weir.social` to a mailbox a person reads

Every message goes from that address and replies to it, and both failure pages at `/unsubscribe`
tell a reader to reply to the message if the link will not work. That sentence has to be true, so
the route has to exist and somebody has to open it. `dmca@weir.social` is the only `weir.social`
address on record today.

### 3. Place the key and the secret

`RESEND_API_KEY` comes out of the machine-key pile and is placed by hand. `WEIR_EMAIL_TOKEN_SECRET`
is generated once — 32 or more random characters — and placed in both environments named above.
Nothing in this repository generates, holds or reads either value.

### 4. Apply migration 042

`node --env-file=.env.local scripts/migrate.mjs` to see it, then `--apply`. It must be applied to the
database the deployment uses, or the first real send fails at the claim, before the provider is
called — which is the safe way for it to fail, but it is still a failed run.

### 5. Have the template

A JSON manifest with an id, a subject, and the two bodies:

```json
{
  "id": "a stable name for this message, never reused",
  "subject": "…",
  "html": "…{{unsubscribe_url}}…",
  "text": "…{{unsubscribe_url}}…"
}
```

Design hands over an HTML file and a text file rather than a JSON string, so a body may instead be
pointed at beside the manifest — which is the form to use, because the alternative is pasting an
email body into JSON and escaping it by hand:

```json
{
  "id": "weir-where-we-are-01",
  "subject": "You asked to be told. Here is where the doors are.",
  "htmlPath": "weir-where-we-are-01.html",
  "textPath": "weir-where-we-are-01.txt"
}
```

Paths are relative to the manifest. A body given both ways is refused; a body read from a file is
held to every rule an inline one is.

`{{unsubscribe_url}}` is the only substitution the sender performs, and it must appear in **both**
bodies or the template is refused. `id` is what the send log is keyed on: reusing an id means the
message cannot be sent to anybody who has already had one under it, and changing an id means it can
be sent again to everybody.

### 6. Query the provider before the run, and again after any failure

The standing rule, and the reason it exists: on 2026-08-30 one prospect received the same card twice,
eight minutes apart, because an attempt that looked failed was retried with nothing remembering the
first. `GET https://api.resend.com/emails` answers what the provider actually holds. A `403`, a
timeout or a dropped connection is not evidence that nothing was sent.

### 7. The word for that specific send, on the day

Not a general approval, and not an old one. `WEIR_EMAIL_SEND_APPROVED=1` is the shape that word takes
in the environment; it is not the word itself.

## Running it

```bash
# Dry run — renders every message, sends nothing, writes nothing. Needs no provider key.
node --env-file=.env.local scripts/send-waitlist-email.mjs --template=./message.json --list

# One test address, for real, once every condition above is met.
WEIR_EMAIL_SEND_APPROVED=1 node --env-file=.env.local scripts/send-waitlist-email.mjs \
  --template=./message.json --to=someone@ours.example --really-send

# The list, for real.
WEIR_EMAIL_SEND_APPROVED=1 node --env-file=.env.local scripts/send-waitlist-email.mjs \
  --template=./message.json --list --really-send
```

`--origin=http://localhost:3000` points the unsubscribe links at a local server, for reading a dry
run against a running app. It has no effect on anything else and must never be used on a real send.

## When a send fails on the wire

The row in `waitlist_email_sends` was claimed before the provider was called, so the address will be
skipped on the next run and the script prints it as unresolved before it starts. That refusal is
correct: after a failed attempt nobody knows whether a message was created.

The way out is step 6, not a code change. Query the provider for that recipient and that subject. If
it holds nothing, delete that one row by hand and run again:

```sql
DELETE FROM waitlist_email_sends
 WHERE email = 'the.address@example.com'
   AND template_id = 'the-template-id'
   AND provider_message_id IS NULL;
```

If it holds a message, the message went; write its id into the row rather than sending a second one.

## What this does not do

- It does not send anything by itself, on any schedule, from any route. There is one command and it
  refuses twice before it sends.
- It does not add a consent column. Whether an address may be written to is answered by
  `waitlist_signups` having a row, and the unsubscribe route removes the row.
- It does not build a second list. `waitlist_email_sends` records what was sent and is read only by
  the duplicate guard.
- It does not decide what goes in a message. The template is design's, the words are the marketing
  department's, and the send is the operator's.
