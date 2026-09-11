// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
