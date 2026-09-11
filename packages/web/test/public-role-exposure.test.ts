// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'db');

const sql = readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort()
  .map((filename) => ({ filename, body: readFileSync(join(DIR, filename), 'utf8') }));

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
    expect(created.has('encryption_keys')).toBe(false);
  });

  it('reads the migrations at all', () => {
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
    const policies = sql
      .filter(({ body }) => /create\s+policy/i.test(body))
      .map(({ filename }) => filename);
    expect(policies).toEqual([]);
  });
});
