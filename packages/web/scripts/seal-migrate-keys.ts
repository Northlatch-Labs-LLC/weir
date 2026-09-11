// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
