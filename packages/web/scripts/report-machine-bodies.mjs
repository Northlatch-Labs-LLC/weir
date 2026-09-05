// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * How many paid posts carry a machine edition, and how many never can.
 *
 *     node --env-file=.env.local scripts/report-machine-bodies.mjs
 *
 * Read-only: three counts over `posts`, nothing written. The third count is the set migration 034
 * indexes as `posts_paid_without_machine_body_idx` — paid posts sealed for humans before machine
 * editions were sealed at publish. Their plaintext is gone, so that number only falls as creators
 * republish; the pricing guard refuses a machine price for every key in it. Run it the day after
 * the change ships and again whenever the number is asked for.
 *
 * The connection string is read from `PROJECTX_DATABASE_URL` and never printed, as `migrate.mjs`
 * does — only the database name and host are shown.
 */
import pg from 'pg';

const url = process.env['PROJECTX_DATABASE_URL'];
if (url === undefined || url.trim() === '') {
  console.error('PROJECTX_DATABASE_URL is not set; nothing to read.');
  process.exit(2);
}

function describe(connectionString) {
  try {
    const u = new URL(connectionString);
    const host = u.searchParams.get('host') ?? u.hostname;
    return `${u.pathname.replace(/^\//, '') || '(default)'} on ${host || '(default)'}`;
  } catch {
    return '(unparseable URL, not shown)';
  }
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(`
    SELECT
      count(*) FILTER (WHERE access_kind = 'paid')                                          AS paid,
      count(*) FILTER (WHERE access_kind = 'paid' AND machine_blob_id IS NOT NULL)          AS with_machine_body,
      count(*) FILTER (WHERE access_kind = 'paid' AND body_blob_id IS NOT NULL
                         AND machine_blob_id IS NULL)                                       AS sealed_without_machine_body,
      count(*) FILTER (WHERE access_kind = 'paid' AND body_blob_id IS NULL)                 AS words_in_column
    FROM posts
  `);
  const r = rows[0];
  console.log(`database: ${describe(url)}`);
  console.log(`paid posts:                       ${r.paid}`);
  console.log(`  with a machine edition:         ${r.with_machine_body}`);
  console.log(`  sealed, no machine edition:     ${r.sealed_without_machine_body}   (pre-034; a machine price is refused until republished)`);
  console.log(`  words still in the body column: ${r.words_in_column}   (pre-020; a machine Unlock reads the column like any other)`);
} finally {
  await client.end();
}
