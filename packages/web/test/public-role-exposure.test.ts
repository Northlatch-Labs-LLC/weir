// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Every table a migration creates is closed to the roles managed Postgres publishes over REST.
 *
 * # The rule, and the hole in how it was enforced
 *
 * `008_close_postgrest_exposure.sql` closed the six tables that existed when it was written and
 * explained the reasoning carefully. Every table added afterwards had to remember that explanation
 * on its own. Most did. `creator_perks`, added by `017`, did not: it sat on production with row
 * level security off and DELETE, INSERT, SELECT, TRUNCATE and UPDATE granted to `anon` and
 * `authenticated` — roles reachable over an interface that does not pass through this application.
 * It held no rows, so nothing leaked; the writable half was the problem, because a perk row nobody
 * here wrote would be shown to readers as something a creator offers. `026` closed it.
 *
 * A rule enforced by remembering has one hole per table added. A seventh paragraph in a migration
 * would not have caught the seventh table.
 *
 * # Why this reads the SQL rather than a database
 *
 * The first version of this test queried `information_schema.role_table_grants` for `anon` and
 * `authenticated` against the test database. It passed. It also passed with `creator_perks`
 * deliberately re-opened, because a local Postgres cluster has no `anon` role at all — so the
 * grants query returned "none" for every table and every table read as closed. It could not fail,
 * which makes it worse than absent: it reported a clean schema without being able to see one.
 *
 * The migrations are the same everywhere, so they are what gets checked. This runs with no
 * database, in any environment, and fails by name the moment a migration adds a table without
 * closing it.
 *
 * # The two ways a table is closed
 *
 * Row level security with no policy denies those roles everything, while the owning role this
 * deployment connects as bypasses RLS entirely. Revoking the grants closes the same door from the
 * other side. Both patterns are in use here and either is sufficient, so this asserts the property
 * and not the mechanism.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'db');

/** Every migration, in the order they are applied. */
const sql = readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort()
  .map((filename) => ({ filename, body: readFileSync(join(DIR, filename), 'utf8') }));

/** `public.` is optional in this repository's SQL and means the same thing. */
const bare = (name: string) => name.replace(/^public\./i, '').toLowerCase();

function matchAll(pattern: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const { filename, body } of sql) {
    for (const m of body.matchAll(pattern)) {
      const name = bare(m[1]!);
      if (!found.has(name)) found.set(name, filename);
    }
  }
  return found;
}

/**
 * The tables that exist after every migration has run.
 *
 * Creates and drops are replayed in order — across files and within each file — rather than
 * collected into two sets, because a table can be created, dropped, and created again, and only
 * the last operation decides whether it is there to be exposed.
 *
 * `002_e2e.sql` creates `encryption_keys` and `004_keys_move_on_chain.sql` deletes it, deliberately
 * and with its reasoning written out: the key registry moved to Sui, and keeping the table would
 * have been a second source of truth for the same question. A test that ignored drops would demand
 * that a table which does not exist be closed, and the only way to satisfy it would be to add
 * protection to something absent.
 */
function liveTables(): Map<string, string> {
  const live = new Map<string, string>();
  const CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_.]+)/gi;
  const DROP = /drop\s+table\s+(?:if\s+exists\s+)?([a-z_.]+)/gi;
  for (const { filename, body } of sql) {
    const events: Array<{ at: number; drop: boolean; name: string }> = [];
    for (const m of body.matchAll(CREATE)) {
      events.push({ at: m.index ?? 0, drop: false, name: bare(m[1]!) });
    }
    for (const m of body.matchAll(DROP)) {
      events.push({ at: m.index ?? 0, drop: true, name: bare(m[1]!) });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.drop) live.delete(e.name);
      else if (!live.has(e.name)) live.set(e.name, filename);
    }
  }
  return live;
}

const created = liveTables();
const rlsEnabled = matchAll(/alter\s+table\s+([a-z_.]+)\s+enable\s+row\s+level\s+security/gi);
const revoked = matchAll(/revoke\s+all\s+on\s+([a-z_.]+)\s+from\s+(?:anon|authenticated)/gi);

describe('the migrations close every table they create', () => {
  it('a table dropped by a later migration is not demanded to be closed', () => {
    // encryption_keys is created by 002 and deleted by 004. This asserts the replay actually
    // removes it, because without that this suite fails on a table that does not exist.
    expect(created.has('encryption_keys')).toBe(false);
  });

  it('reads the migrations at all', () => {
    // Without this, a glob that matched nothing would make every assertion below vacuously true —
    // which is the exact failure this test was rewritten to escape.
    expect(sql.length).toBeGreaterThan(20);
    expect(created.size).toBeGreaterThan(10);
  });

  it('every created table is closed, by RLS or by revoked grants', () => {
    const open = [...created.entries()]
      .filter(([table]) => !rlsEnabled.has(table) && !revoked.has(table))
      // Named with the migration that created it, so the failure says where to go.
      .map(([table, filename]) => `${table} (created in ${filename})`);
    expect(open).toEqual([]);
  });

  it('names creator_perks as closed — the table this test was written for', () => {
    expect(created.has('creator_perks')).toBe(true);
    expect(rlsEnabled.has('creator_perks') || revoked.has('creator_perks')).toBe(true);
  });

  it('names the three agent tables as closed', () => {
    for (const table of ['agent_accounts', 'agent_requests', 'agent_quotas']) {
      expect(created.has(table), `${table} is not created by any migration`).toBe(true);
      expect(rlsEnabled.has(table) || revoked.has(table), `${table} is left open`).toBe(true);
    }
  });

  it('no migration adds a policy, which would re-open a table', () => {
    /*
      RLS denies the published roles everything precisely because there is no policy. A policy is
      what grants access back, so adding one to silence a tool reporting "RLS enabled with no
      policies" would undo the protection that report is describing. 008 says so in as many words;
      this makes it fail rather than rely on the next person having read it.
    */
    const policies = sql
      .filter(({ body }) => /create\s+policy/i.test(body))
      .map(({ filename }) => filename);
    expect(policies).toEqual([]);
  });
});
