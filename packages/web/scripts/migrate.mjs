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

/*
  Run only when this file IS the command, not when something imports it.

  The rules that decide whether a migration may run inside a transaction are worth testing, and a
  module that connects to a database and calls `process.exit` at import time cannot be tested at
  all. Nothing about the command changes: `node scripts/migrate.mjs` still reads the environment,
  still refuses to start without it, and still exits 2.
*/
const RUN_AS_COMMAND = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const url = process.env['PROJECTX_DATABASE_URL'];
if (RUN_AS_COMMAND && (url === undefined || url.trim() === '')) {
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

/**
 * SQL with its comments removed, so a rule never matches a sentence describing it.
 *
 * Both checks below decide whether a file may run inside a transaction, and both would be wrong if
 * a docblock explaining `CREATE INDEX CONCURRENTLY` counted as using it. A migration's comments are
 * usually longer than its statements here, so this is the common case rather than the corner.
 */
export function statementsOnly(sql) {
  /*
    `--` to end of line ANYWHERE, not only where a line begins with it.

    A trailing comment is the ordinary way to annotate a statement, and stripping only whole-line
    comments left `CREATE INDEX i ON t (c); -- one day, CONCURRENTLY` reading as a file that uses
    CONCURRENTLY. That is the expensive direction: it refuses a valid migration, in a message about
    a restriction the file does not actually hit.

    This does not parse SQL, so a `--` inside a string literal takes the rest of that line with it.
    That can only ever hide a real CONCURRENTLY, never invent one — and a hidden one is caught
    immediately by Postgres, in its own words, on a file that has been applied to nothing. The
    asymmetry is deliberate: a false refusal blocks a deployment, a false permission does not.
  */
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}

/** The marker a migration writes to opt out of the wrapper, on a line of its own. */
export const OUTSIDE_MARKER = 'weir:outside-a-transaction';

/**
 * Whether this file asked to run outside a transaction.
 *
 * Read from the RAW text, not from `statementsOnly`: the marker is a comment, which is the only
 * place it can live in a file that must remain valid SQL.
 */
export function runsOutsideATransaction(sql) {
  return new RegExp(`^\\s*--\\s*${OUTSIDE_MARKER}\\s*$`, 'm').test(sql);
}

/**
 * Whether this file contains a statement Postgres refuses inside a transaction block.
 *
 * `CREATE INDEX CONCURRENTLY` is the one that matters here, and the reason this whole opt-out
 * exists: without it, no migration can ever add an index to a live table without taking
 * `ACCESS EXCLUSIVE` on it for the duration of the build. `DROP INDEX CONCURRENTLY` and
 * `REINDEX CONCURRENTLY` carry the same restriction.
 */
export function needsToRunOutsideATransaction(sql) {
  return /\bconcurrently\b/i.test(statementsOnly(sql));
}

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
  /*
    Refuse the whole run before applying anything, rather than failing partway.

    A file using `CONCURRENTLY` without the marker cannot work: Postgres rejects it inside a
    transaction block, and every file is wrapped in one by default. That failure arrives as a
    Postgres error naming a restriction rather than the fix, halfway through a migration set. This
    says the sentence the author needs, and says it while nothing has been applied yet.
  */
  const mislabelled = pending.filter(
    (m) => needsToRunOutsideATransaction(m.sql) && !runsOutsideATransaction(m.sql),
  );
  if (mislabelled.length > 0) {
    for (const m of mislabelled) {
      console.error(`  REFUSED   ${m.filename}: uses CONCURRENTLY inside a transaction`);
    }
    console.error(
      `\nPostgres will not run CONCURRENTLY inside a transaction block, and every migration is\n` +
        `wrapped in one. Add this as the first line of the file to opt out:\n\n` +
        `    -- ${OUTSIDE_MARKER}\n\n` +
        `Read what that costs in the block above it before you do — an unwrapped file that fails\n` +
        `is left half-applied, and CREATE INDEX CONCURRENTLY leaves an INVALID index behind.\n`,
    );
    await client.end();
    process.exit(1);
  }

  for (const m of pending) {
    const unwrapped = runsOutsideATransaction(m.sql);
    try {
      if (unwrapped) {
        /*
          No transaction, because the file said so and because the statement it holds cannot run in
          one. `CREATE INDEX CONCURRENTLY` builds without taking `ACCESS EXCLUSIVE` on the table —
          which is the entire reason to want it on a live deployment, and was impossible here until
          this branch existed.

          The timeouts are set on the SESSION rather than inside a transaction, so they must be put
          back afterwards: this connection runs the remaining migrations too, and leaving a ceiling
          of zero on it would silently exempt every later file from a limit it was meant to keep.
        */
        await client.query('set statement_timeout = 0');
        await client.query('set lock_timeout = 0');
        try {
          await client.query(m.sql);
          await client.query(
            'insert into schema_migrations (filename, checksum) values ($1, $2)',
            [m.filename, m.checksum],
          );
        } finally {
          await client.query('reset statement_timeout').catch(() => {});
          await client.query('reset lock_timeout').catch(() => {});
        }
        console.log(`  applied   ${m.filename}  (outside a transaction)`);
        continue;
      }

      // Its own transaction. A failure leaves nothing behind and is not recorded, so the next run
      // retries exactly this file rather than the ones that already succeeded.
      await client.query('begin');
      /*
        Migrations are exempt from the statement ceiling, deliberately and explicitly.

        `028` puts a `statement_timeout` on the `postgres` role, which is the role this runner
        connects as. Without this line the ceiling would apply to migrations too, and the work that
        legitimately runs long is exactly the migration work: an index build over a large table, or
        the whole-table `UPDATE` in `019`. Those would begin to fail at the ceiling — on a big table,
        every time — and the failure would look like a broken migration rather than a timeout doing
        its job.

        `0` is "no limit", set inside the transaction, so it lasts for this file and no longer. The
        ceiling is for the request path, which should never hold a connection for seconds; a
        migration is the one place in this system where holding one is correct.
      */
      await client.query('set statement_timeout = 0');
      await client.query('set lock_timeout = 0');
      await client.query(m.sql);
      await client.query(
        'insert into schema_migrations (filename, checksum) values ($1, $2)',
        [m.filename, m.checksum],
      );
      await client.query('commit');
      console.log(`  applied   ${m.filename}`);
    } catch (error) {
      console.error(`  FAILED    ${m.filename}: ${error.message}`);
      if (unwrapped) {
        /*
          There is nothing to roll back, and saying "rolled back" here would be a lie that costs an
          operator the one thing they need to know: the database is in a state this tool did not
          choose and cannot describe.
        */
        console.error(
          `\nNOT rolled back. This file ran outside a transaction, so whatever succeeded before the\n` +
            `failure is still applied, and it was NOT recorded in schema_migrations — so the next run\n` +
            `will attempt the whole file again.\n\n` +
            `If it was building an index, Postgres has left an INVALID one behind. Find it with\n` +
            `  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;\n` +
            `drop it, then re-run.\n`,
        );
      } else {
        await client.query('rollback').catch(() => {});
        console.error('\nRolled back. Nothing from this file was kept and it was not recorded.\n');
      }
      await client.end();
      process.exit(1);
    }
  }
  console.log(`\nApplied ${pending.length} migration(s).\n`);
  await client.end();
}

if (RUN_AS_COMMAND) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
