// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db');
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const BASELINE = args.has('--baseline');
const through = [...args].find((a) => a.startsWith('--through='))?.slice('--through='.length);

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

export function statementsOnly(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}

export const OUTSIDE_MARKER = 'weir:outside-a-transaction';

export function runsOutsideATransaction(sql) {
  return new RegExp(`^\\s*--\\s*${OUTSIDE_MARKER}\\s*$`, 'm').test(sql);
}

export function needsToRunOutsideATransaction(sql) {
  return /\bconcurrently\b/i.test(statementsOnly(sql));
}

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

      await client.query('begin');
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
