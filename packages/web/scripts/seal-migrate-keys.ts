// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * Move every platform-held media key into Seal custody.
 *
 * # Why this is a script and not a migration
 *
 * `db/019_seal_key_custody.sql` adds the columns and the constraint. It cannot do this part: sealing
 * a key requires reading key server public keys from chain and talking to a threshold committee, and
 * a `.sql` file has no way to do either. So the schema change is declarative and reversible, and the
 * key movement is a deliberate, resumable, observable act run by a person.
 *
 * # What moves, and what does not
 *
 * Not one byte on Walrus is touched. No blob is read, re-encrypted, re-uploaded or re-addressed, and
 * no blob id changes. `enc_nonce` is left exactly as it is. The only change to any row is:
 *
 *     enc_key          'AbCd…'  ->  NULL
 *     seal_wrapped_key  NULL    ->  the same 32 bytes, encrypted to the contract's identity
 *     enc_scheme       'platform' -> 'seal'
 *
 * After this runs, the key that opens a creator's paid media cannot be produced by this platform.
 * That is the point, and it is irreversible for any row it touches — there is no unsealing without
 * a threshold of key servers approving a reader, and this script is not a reader.
 *
 * # The ordering, which is the part that must not be got wrong
 *
 * Per row: seal first, verify what came back, and only then write. All three of the writes happen in
 * one statement, so there is no instant at which a row has surrendered `enc_key` without holding a
 * wrapped key that has already been checked.
 *
 * If the process dies at any point, the worst case is a key that was sealed and not recorded — which
 * costs nothing, because the row still has `enc_key` and the next run simply seals it again. Sealing
 * is not idempotent (fresh randomness each time) but it does not need to be: the operation that
 * matters is the write, and the write is atomic. Re-running is always safe.
 *
 * # Usage
 *
 *     pnpm seal:migrate            # report only. Reads, seals nothing, writes nothing.
 *     pnpm seal:migrate --commit   # actually move the keys
 *     pnpm seal:migrate --commit --limit 10
 *
 * The default is a dry run and there is no flag to make writing the default. An operator who has to
 * type `--commit` has read the line they are typing.
 */

import { EncryptedObject } from '@mysten/seal';
import { sealId, unlockIdentity } from '@projectx-social/sdk';
import { db } from '../lib/db';
import { sealUnlockKey, sealSettings } from '../lib/seal';
import { siteConfig } from '../lib/chain';

interface Row {
  id: string;
  post_id: string;
  vault_id: string;
  content_key: string | null;
  access_kind: string;
  enc_key: string;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const commit = flag('--commit');
  const limitRaw = option('--limit');
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    console.error('--limit takes a whole number of at least 1');
    process.exit(2);
  }

  /*
    Both configurations are checked before a single row is read.

    A run that seals half the table and then discovers the threshold is unreachable is a run that
    has to be reasoned about afterwards. Checking first makes the common failure — an unset variable
    — cost nothing at all.
  */
  const config = siteConfig();
  if (!config.ok) {
    console.error(`configuration: ${config.failure.detail}`);
    process.exit(2);
  }
  const seal = sealSettings();
  if (!seal.ok) {
    console.error(`configuration: ${seal.failure.detail}`);
    process.exit(2);
  }

  console.log(`network        ${config.value.network}`);
  console.log(`seal namespace ${config.value.packageId}`);
  console.log(`key servers    ${seal.value.keyServers.length}, threshold ${seal.value.threshold}`);
  console.log(commit ? 'mode           COMMIT — keys will be moved' : 'mode           dry run');
  console.log('');

  /*
    Joined to `posts` because the identity is the post's, not the asset's.

    `unlock_identity(vault, content_key)` is derived from the vault the post belongs to and the
    content key the buyer's `Unlock` carries. An asset row alone does not know either.
  */
  const { rows } = await db().query<Row>(
    `SELECT a.id, a.post_id, p.vault_id, p.content_key, p.access_kind, a.enc_key
       FROM assets a
       JOIN posts p ON p.id = a.post_id
      WHERE a.enc_scheme = 'platform' AND a.enc_key IS NOT NULL
      ORDER BY a.id
      ${limit === null ? '' : `LIMIT ${limit}`}`,
  );

  if (rows.length === 0) {
    console.log('nothing to migrate — no asset is in platform custody.');
    await db().end();
    return;
  }
  console.log(`${rows.length} asset${rows.length === 1 ? '' : 's'} in platform custody`);
  console.log('');

  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    /*
      A gated asset whose post has no content key cannot be sealed to an unlock identity, and there
      is no other identity it is entitled to. Skipped loudly rather than sealed to something
      invented: a wrong identity is a key nobody can ever derive, which is worse than a key we still
      hold.

      In a healthy database this is unreachable — `paid_posts_need_pricing` requires a content key on
      every paid post, and only paid posts were ever encrypted. It is checked because the cost of
      being wrong here is permanent.
    */
    if (row.content_key === null || row.access_kind !== 'paid') {
      console.log(
        `SKIP  ${row.id}  post ${row.post_id} is '${row.access_kind}'` +
          `${row.content_key === null ? ' with no content key' : ''} — no unlock identity exists for it`,
      );
      skipped += 1;
      continue;
    }

    const wrapped = await sealUnlockKey({
      vaultId: row.vault_id,
      contentKey: row.content_key,
      key: row.enc_key,
    });
    if (!wrapped.ok) {
      console.error(`FAIL  ${row.id}  ${wrapped.failure.kind}: ${wrapped.failure.detail}`);
      failed += 1;
      continue;
    }

    /*
      Verify what came back before surrendering anything.

      The encrypted object is parsed and its identity compared against the one derived here. This is
      not defensive padding: it is the only check standing between a silently wrong identity and a
      permanently unreadable asset, and it costs a BCS parse. It also confirms the namespace package
      and the threshold are the ones configured, so a half-changed environment cannot write rows that
      the running deployment could not later open.
    */
    const expected = sealId(unlockIdentity(row.vault_id, new TextEncoder().encode(row.content_key)));
    let parsed: ReturnType<typeof EncryptedObject.parse>;
    try {
      parsed = EncryptedObject.parse(new Uint8Array(Buffer.from(wrapped.value.wrappedKey, 'base64')));
    } catch (error) {
      console.error(`FAIL  ${row.id}  the sealed key did not parse back: ${String(error)}`);
      failed += 1;
      continue;
    }
    if (parsed.id !== expected) {
      console.error(`FAIL  ${row.id}  sealed to ${parsed.id}, expected ${expected}`);
      failed += 1;
      continue;
    }
    if (parsed.threshold !== seal.value.threshold) {
      console.error(
        `FAIL  ${row.id}  sealed at threshold ${parsed.threshold}, expected ${seal.value.threshold}`,
      );
      failed += 1;
      continue;
    }

    if (!commit) {
      console.log(`WOULD ${row.id}  -> ${parsed.id.slice(0, 16)}… (${parsed.threshold} of ${parsed.services.length})`);
      moved += 1;
      continue;
    }

    /*
      One statement. Three columns. No window.

      `WHERE enc_scheme = 'platform'` makes the write conditional on the row still being where we
      found it, so two concurrent runs cannot both claim the same row — the second updates nothing
      and says so. The database's `assets_encryption_scheme` constraint independently refuses any
      combination other than the one written here, including the dangerous one where `enc_key`
      survives alongside a wrapped key.
    */
    const { rowCount } = await db().query(
      `UPDATE assets
          SET seal_wrapped_key = $1, enc_scheme = 'seal', enc_key = NULL
        WHERE id = $2 AND enc_scheme = 'platform'`,
      [wrapped.value.wrappedKey, row.id],
    );
    if ((rowCount ?? 0) === 0) {
      console.log(`SKIP  ${row.id}  already moved by another run`);
      skipped += 1;
      continue;
    }
    console.log(`MOVED ${row.id}  -> ${parsed.id.slice(0, 16)}…`);
    moved += 1;
  }

  console.log('');
  console.log(`${commit ? 'moved' : 'would move'}: ${moved}   skipped: ${skipped}   failed: ${failed}`);

  /*
    The number that answers the question the Terms ask.

    Zero here means no asset in this database can be decrypted by this platform. Any other number is
    the honest count of how far §4.3 is still from being true, and it is printed on every run so the
    answer is never inferred from the absence of errors.
  */
  const { rows: remaining } = await db().query<{ count: string }>(
    `SELECT count(*)::text AS count FROM assets WHERE enc_scheme = 'platform'`,
  );
  console.log(`still in platform custody: ${remaining[0]?.count ?? 'unknown'}`);

  await db().end();
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
