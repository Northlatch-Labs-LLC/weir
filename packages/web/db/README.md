# Database

Postgres. Migrations are the numbered files in this directory, applied by
`scripts/migrate.mjs` — **never by hand.**

```bash
createdb projectx_social
node --env-file=.env.local scripts/migrate.mjs           # what would happen; changes nothing
node --env-file=.env.local scripts/migrate.mjs --apply   # do it
```

This file used to say `psql -d projectx_social -f db/001_init.sql`, then 002, then 003. That worked
exactly once, on one machine, for as long as somebody remembered where they had stopped — and by
the time the runner existed there were thirty-two files, so the instruction was three of them and
an implied "and the rest, in order, by memory". A README that tells a new operator to apply
migrations by hand against a live database is worse than one that says nothing.

The runner is not a convenience. It enforces four things a person cannot:

- **In filename order, once each.** A file already recorded in `schema_migrations` is skipped by
  name, so the same file cannot be applied twice or missed.
- **Each in its own transaction.** A file that fails leaves nothing behind and is not recorded, so
  the next run retries exactly it.
- **Checksums.** The sha256 of every applied file is stored. If a file that was already applied has
  since changed on disk, the run STOPS before doing anything — the database and the repository
  disagree about what was run, and continuing would bury that.
- **Dry run by default.** `--apply` is required to write. A tool that migrates because you typed
  its name is a tool that migrates when you meant to look.

`PROJECTX_DATABASE_URL` must be set — there is no default, because a default connection string is
how a deployment silently writes to the wrong database, or to a developer's, which is worse because
it appears to work.

On a Homebrew install the server listens on its own socket directory rather than `/tmp`, so the URL
carries the path:

```
PROJECTX_DATABASE_URL=postgresql:///projectx_social?host=/usr/local/var/postgresql@16/sockets
```

## What the schema will not store

There is no column recording who may read what. Entitlement is decided by objects held on Sui, and
this database has no say in it. A `may_read` column would be a second source of truth for the one
question the chain already answers, and the two would drift — which is exactly how the platform
being replaced ended up serving paid images to anyone who knew a filename.

## What the constraints are for

They refuse states the contract will not honour, so the store cannot describe something the chain
would reject:

- `paid_posts_need_pricing` — a paid post without a price and content key is unsellable, because
  `unlock` reads the price from chain and refuses content that has none.
- `no_self_messages` — a thread with yourself is not a thread.
- `follows` has a composite primary key, so following twice is not a second follow. The database
  says so rather than leaving the application to remember.
- `encrypted_rows_are_complete` — an encrypted message must carry everything needed to decrypt it
  **and** carry no plaintext. Half of that is obvious; the other half is the one that matters. A
  row with a plaintext preview beside its ciphertext leaks the opening of every message, which is
  most of what most messages say.
- `encrypted_messages_are_not_paid` — a paid message works because the server withholds the body
  until the buyer holds an Unlock object on chain. An encrypted message ships the recipient's key
  envelope in the same row, so there is nothing left to withhold. The two cannot both be true.

## What the encryption changes here, and what it does not

`encryption_keys` maps an address to a published X25519 key. The row is written only after the
server has verified a signature by that address over that key, so this database stores a binding it
checked rather than one it asserts — a compromised deployment can withhold or stale a key, but
cannot mint one. `lib/e2e.ts` has the scheme.

`messages.ciphertext`, `nonce` and `envelopes` hold bytes nothing in this system can open. There is
no key column and there is no plan for one.

**Metadata is not encrypted and is not intended to be.** `from_addr`, `to_addr` and `created_at_ms`
are stored in the clear on every row, encrypted or not — who talks to whom and when is fully
visible to whoever holds this database. Encrypting the bodies does not hide the social graph, and
the messages page says so to the user in those words.

Addresses are stored lower-cased and zero-padded. Sui addresses are hex and case-insensitive, and
they arrive from wallets, query strings and event logs in whichever case each produced — storing
them as given makes `follower = $1` miss and turns that composite key into no key at all.
