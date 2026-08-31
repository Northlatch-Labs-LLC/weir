// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Apply the SQL in `db/`, in order, once each, and keep a record of it.
 *
 *     node --env-file=.env.local scripts/migrate.mjs            # dry run: what would happen
 *     node --env-file=.env.local scripts/migrate.mjs --baseline --through=022 --apply
 *     node --env-file=.env.local scripts/migrate.mjs --apply    # actually run the pending ones
 *
 * # Why this exists
 *
 * `db/README.md` says to run `psql -f db/001_init.sql`, then 002, then 003, by hand. That works
 * exactly once, on one machine, for as long as somebody remembers where they stopped. Nothing in
 * the database recorded what had been applied, so "is 023 in production?" was a question answered
 * by looking for a table and inferring — and inference is how a migration gets applied twice or
 * skipped entirely.
 *
 * So: a `schema_migrations` ledger, and every decision below reads from it rather than from the
 * shape of the schema.
 *
 * # The rules it enforces
 *
 *  - **In filename order.** `023` before `024`. Order is the whole contract of a migration set.
 *  - **Once each.** A file already in the ledger is skipped, silently and by name.
 *  - **Each in its own transaction.** A file that fails leaves nothing behind and is not recorded,
 *    so the next run retries exactly it. Postgres does DDL transactionally, which is what makes
 *    this possible at all.
 *  - **Checksums.** The sha256 of every applied file is stored. If a file already applied has
 *    changed on disk, the run stops before doing anything. An edited migration means the database
 *    and the repository disagree about what was run, and continuing would bury that.
 *  - **Dry run by default.** `--apply` is required to write. A tool that migrates because you
 *    typed its name is a tool that migrates when you meant to look.
 *
 * # The connection string is never printed
 *
 * Not in output, not in errors, not in the dry run. It is read from `PROJECTX_DATABASE_URL` and
 * only the database name and host are ever shown, because "which database am I about to change"
 * is the one question an operator must be able to answer out loud without leaking a credential.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db');
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const BASELINE = args.has('--baseline');
/**
 * The last migration the existing schema actually reflects, e.g. `--through=022`.
 *
 * Required with `--baseline`, and the reason is the case this repository is in right now: the
 * database was migrated by hand up to 022, and 023 to 025 have never been run. A baseline that
 * adopted everything pending would record those three as applied without creating their tables —
 * leaving a database that reports itself migrated and has no `agent_accounts` in it. That is worse
 * than an unmigrated database, because the ledger now lies and the next run has nothing to do.
 */
const through = [...args].find((a) => a.startsWith('--through='))?.slice('--through='.length);

const url = process.env['PROJECTX_DATABASE_URL'];
if (url === undefined || url.trim() === '') {
  console.error(
    'PROJECTX_DATABASE_URL is not set. There is no default — a default connection string is how ' +
      'a deployment silently migrates the wrong database.',
  );
  process.exit(2);
}

/** Host and database only. Never the user, never the password, never the query string. */
function describe(connectionString) {
  try {
    const u = new URL(connectionString);
    const host = u.hostname || u.searchParams.get('host') || '(local socket)';
    const database = u.pathname.replace(/^\//, '') || '(default)';
    return `${database} on ${host}`;
  } catch {
    return '(a connection string that does not parse as a URL)';
  }
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Every `NNN_name.sql` in db/, in filename order. */
function migrations() {
  return readdirSync(DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(DIR, filename), 'utf8');
      return { filename, sql, checksum: sha256(sql) };
    });
}

const LEDGER = `
  create table if not exists schema_migrations (
    filename   text        primary key,
    checksum   text        not null,
    applied_at timestamptz not null default now()
  )
`;

async function main() {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (error) {
    // The message can carry the host. The connection string itself never does.
    console.error(`could not connect to ${describe(url)}: ${error.message}`);
    process.exit(1);
  }

  console.log(`\ndatabase: ${describe(url)}`);
  console.log(`mode:     ${BASELINE ? 'baseline' : APPLY ? 'APPLY' : 'dry run'}\n`);

  await client.query(LEDGER);
  const applied = new Map(
    (await client.query('select filename, checksum from schema_migrations')).rows.map((r) => [
      r.filename,
      r.checksum,
    ]),
  );

  const files = migrations();

  /*
    Drift is checked across every applied file before anything runs.

    A migration edited after it was applied means the database and the repository disagree about
    what was executed. Stopping first, rather than at the file, keeps the database untouched while
    that is worked out — and there is no `--force`, because the resolution is to write a new
    migration, never to change the record of an old one.
  */
  const drifted = files.filter(
    (m) => applied.has(m.filename) && applied.get(m.filename) !== m.checksum,
  );
  if (drifted.length > 0) {
    console.error('these files have changed since they were applied:\n');
    for (const m of drifted) console.error(`  ${m.filename}`);
    console.error(
      '\nThe database and this repository disagree about what was run. Nothing was changed. ' +
        'Write a new migration; do not edit one that has been applied.',
    );
    await client.end();
    process.exit(1);
  }

  const pending = files.filter((m) => !applied.has(m.filename));

  if (BASELINE) {
    /*
      Adopt a database that predates this ledger.

      The existing deployments were migrated by hand, so their tables exist and their ledger does
      not. Baseline records every file as applied WITHOUT running it — which is only correct on a
      database whose schema already reflects those files, and is destructive nonsense on an empty
      one. It therefore refuses to run when the schema is empty, which is the case it would ruin.
    */
    const tables = await client.query(
      "select count(*)::int as n from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'",
    );
    if (tables.rows[0].n === 0) {
      console.error(
        'refusing to baseline an empty schema: baseline marks migrations as applied without ' +
          'running them, so on an empty database it would record a schema that does not exist. ' +
          'Run --apply instead.',
      );
      await client.end();
      process.exit(1);
    }
    if (through === undefined) {
      console.error(
        '--baseline requires --through=NNN naming the last migration this schema already ' +
          'reflects (for example --through=022). Without it, baseline would adopt migrations ' +
          'that have never run and record tables that do not exist.',
      );
      await client.end();
      process.exit(1);
    }
    const adopt = pending.filter((m) => m.filename.slice(0, through.length) <= through);
    const leave = pending.filter((m) => !adopt.includes(m));
    console.log(`the schema has ${tables.rows[0].n} table(s); recording as already applied:\n`);
    for (const m of leave) {
      // Named explicitly. A baseline that silently ignored these would look like it had covered
      // everything, and the whole point of this boundary is that it must be visible.
      void m;
    }
    for (const m of adopt) {
      console.log(`  baseline  ${m.filename}`);
      if (APPLY) {
        await client.query(
          'insert into schema_migrations (filename, checksum) values ($1, $2) on conflict do nothing',
          [m.filename, m.checksum],
        );
      }
    }
    if (leave.length > 0) {
      console.log(`\nleft pending, to be run for real by --apply:\n`);
      for (const m of leave) console.log(`  pending   ${m.filename}`);
    }
    console.log(
      APPLY
        ? `\nRecorded ${adopt.length} file(s) as already applied. Nothing was executed.\n`
        : `\nDry run. Add --apply to record these. Nothing was executed either way.\n`,
    );
    await client.end();
    return;
  }

  if (pending.length === 0) {
    console.log(`up to date — ${applied.size} migration(s) applied, none pending.\n`);
    await client.end();
    return;
  }

  console.log(`${applied.size} applied, ${pending.length} pending:\n`);
  for (const m of pending) console.log(`  pending   ${m.filename}`);

  if (!APPLY) {
    console.log('\nDry run. Nothing was changed. Add --apply to run these in order.\n');
    await client.end();
    return;
  }

  console.log('');
  for (const m of pending) {
    // Its own transaction. A failure leaves nothing behind and is not recorded, so the next run
    // retries exactly this file rather than the ones that already succeeded.
    try {
      await client.query('begin');
      await client.query(m.sql);
      await client.query(
        'insert into schema_migrations (filename, checksum) values ($1, $2)',
        [m.filename, m.checksum],
      );
      await client.query('commit');
      console.log(`  applied   ${m.filename}`);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      console.error(`  FAILED    ${m.filename}: ${error.message}`);
      console.error('\nRolled back. Nothing from this file was kept and it was not recorded.\n');
      await client.end();
      process.exit(1);
    }
  }
  console.log(`\nApplied ${pending.length} migration(s).\n`);
  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
