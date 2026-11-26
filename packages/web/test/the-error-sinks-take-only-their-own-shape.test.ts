// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// The two routes that write to error_events for strangers, measured against the table itself.
//
// An external scan of weir.social (2026-11-25) posted to /api/csp-report a body that was not a
// violation report, a three-megabyte body, and thirty requests in a row, and found all of them
// accepted; to /api/telemetry/error it posted numbers, objects, carriage returns, escape sequences
// and markup, and found every one stored. Nothing leaked — the rows are the administrator's — but
// the table is what the hourly alarm counts and what that alarm pastes into a public issue, so
// "anyone can write what they like into it, as fast as they like" is a way to bury a real failure
// and to put chosen text in front of the operator.
//
// Each test here is one of those requests, against a real database.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUOTAS, resetRateLimits } from '../lib/rate-limit';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { POST: csp } = await import('../app/api/csp-report/route');
const { POST: crash } = await import('../app/api/telemetry/error/route');

// The table is capped at 50,000 rows and another test fills it to the cap; these tests count rows,
// so they start from an empty one.
beforeAll(async () => {
  await testDb().query('TRUNCATE error_events');
});
afterAll(closeDatabase);

const ORIGIN = 'https://weir.social';
let source = 1;
const nextIp = (): string => `203.0.113.${(source += 1)}`;
/// The shared budget lives in Postgres and refills slowly, so a test that drains it needs an
/// address no earlier run has used.
const freshIp = (): string => `2001:db8:${Date.now().toString(16)}:${source.toString(16)}::1`;

const post = (path: string, body: string, headers: Record<string, string> = {}): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'x-real-ip': nextIp(), ...headers },
    body,
  });

const cspPost = (report: unknown): Request =>
  post('/api/csp-report', JSON.stringify(report), { 'content-type': 'application/csp-report' });

const crashPost = (body: unknown): Request =>
  post('/api/telemetry/error', JSON.stringify(body), { 'content-type': 'application/json' });

interface Row {
  source: string;
  detail: string;
  route: string | null;
}

/** Every error_events row, newest last. Tests compare whole rows, so nothing else may write. */
const rows = async (): Promise<Row[]> =>
  (
    await testDb().query<Row>('SELECT source, detail, route FROM error_events ORDER BY at_ms, id')
  ).rows;

const newest = async (): Promise<Row | undefined> => (await rows()).at(-1);

describe('POST /api/csp-report', () => {
  it('records a real report as exactly what identifies the violation, and nothing more', async () => {
    const before = (await rows()).length;
    const response = await csp(
      cspPost({
        'csp-report': {
          'document-uri': `${ORIGIN}/feed?token=a-secret-in-the-query`,
          'effective-directive': 'script-src',
          'blocked-uri': 'https://evil.example/x.js?v=1#frag',
          'source-file': `${ORIGIN}/_next/static/chunks/a.js?t=2`,
          'line-number': 12,
          disposition: 'enforce',
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(await rows()).toHaveLength(before + 1);
    expect(await newest()).toEqual({
      source: 'csp.violation',
      route: '/feed',
      detail:
        `directive=script-src blocked=https://evil.example/x.js disposition=enforce ` +
        `source=${ORIGIN}/_next/static/chunks/a.js:12`,
    });
  });

  it('keeps nothing from a body that is not a violation report, however it is shaped', async () => {
    const before = (await rows()).length;
    for (const body of [
      { note: 'anything', anything: [1, 2], detail: '<svg onload=alert(61)>' },
      { 'csp-report': { 'blocked-uri': 'inline' } },
      { 'csp-report': 'a string' },
      [],
      [1, 2, 3],
    ]) {
      expect((await csp(cspPost(body))).status).toBe(204);
    }
    expect(await rows()).toHaveLength(before);
  });

  it('drops a field that is not the shape the format gives it, rather than storing what was sent', async () => {
    const response = await csp(
      cspPost({
        'csp-report': {
          'document-uri': `${ORIGIN}/studio`,
          'violated-directive': 'img-src',
          'effective-directive': '<svg onload=alert(61)>',
          'blocked-uri': '<img src=x onerror=alert(61)>',
          'source-file': 61,
          'line-number': '<svg onload=alert(61)>',
          disposition: ['enforce'],
        },
      }),
    );
    expect(response.status).toBe(204);
    expect((await newest())?.detail).toBe(
      'directive=img-src blocked=(unspecified) disposition=(none) source=(none):?',
    );
  });

  it('reads a Reporting-API wrapper the same way', async () => {
    const response = await csp(
      post(
        '/api/csp-report',
        JSON.stringify([{ type: 'csp-violation', body: { 'effective-directive': 'connect-src', 'blocked-uri': 'https://api.example/v1', 'line-number': '7' } }]),
        { 'content-type': 'application/reports+json' },
      ),
    );
    expect(response.status).toBe(204);
    expect((await newest())?.detail).toBe(
      'directive=connect-src blocked=https://api.example/v1 disposition=(none) source=(none):7',
    );
  });

  it('refuses a body past what ten reports could weigh, and records none of it', async () => {
    const before = (await rows()).length;
    const response = await csp(cspPost({ 'csp-report': { 'effective-directive': 'x'.repeat(40_000) } }));
    expect(response.status).toBe(413);
    expect(await rows()).toHaveLength(before);
  });

  it('answers 415 to another content type, and 400 to a body that is not JSON', async () => {
    expect((await csp(cspPost({ 'csp-report': {} }))).status).toBe(204);
    expect((await csp(post('/api/csp-report', '{}', { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await csp(cspPostRaw('{not json'))).status).toBe(400);
  });

  it('counts against a budget that holds across instances, and stops at it', async () => {
    const before = (await rows()).length;
    resetRateLimits();
    const ip = freshIp(); // a bucket lives in the database, so it must be new on every run
    let last: Response | null = null;
    for (let i = 0; i < QUOTAS.errorReport.capacity; i += 1) {
      last = await csp(
        new Request(`${ORIGIN}/api/csp-report`, {
          method: 'POST',
          headers: { 'x-real-ip': ip, 'content-type': 'application/csp-report' },
          body: JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'data' } }),
        }),
      );
      expect(last.status).toBe(204);
    }
    expect(await rows()).toHaveLength(before + QUOTAS.errorReport.capacity);

    const over = await csp(
      new Request(`${ORIGIN}/api/csp-report`, {
        method: 'POST',
        headers: { 'x-real-ip': ip, 'content-type': 'application/csp-report' },
        body: JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'data' } }),
      }),
    );
    expect(over.status).toBe(429);
    expect(await rows()).toHaveLength(before + QUOTAS.errorReport.capacity);
  });
});

function cspPostRaw(body: string): Request {
  return post('/api/csp-report', body, { 'content-type': 'application/csp-report' });
}

describe('POST /api/telemetry/error', () => {
  it('stores a crash as one line a person can read', async () => {
    const response = await crash(
      crashPost({ source: 'browser crash', detail: 'Minified React error #185\n    at a (b)', route: '/studio' }),
    );
    expect(response.status).toBe(200);
    expect(await newest()).toEqual({ source: 'browser crash', detail: 'Minified React error #185 at a (b)', route: '/studio' });
  });

  it('counts against the same shared budget, and stops at it', async () => {
    const before = (await rows()).length;
    resetRateLimits();
    const ip = freshIp();
    const send = (): Promise<Response> =>
      crash(
        new Request(`${ORIGIN}/api/telemetry/error`, {
          method: 'POST',
          headers: { 'x-real-ip': ip, 'content-type': 'application/json' },
          body: JSON.stringify({ source: 'browser crash', detail: 'x', route: '/studio' }),
        }),
      );
    for (let i = 0; i < QUOTAS.errorReport.capacity; i += 1) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(await rows()).toHaveLength(before + QUOTAS.errorReport.capacity);
  });

  it('refuses a body past a message and a path, and records none of it', async () => {
    const before = (await rows()).length;
    const response = await crash(crashPost({ source: 'browser crash', detail: 'x'.repeat(20_000) }));
    expect(response.status).toBe(413);
    expect(await rows()).toHaveLength(before);
  });
});
