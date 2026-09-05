// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// `weir.social/waitlist` has promised since it was written that "one click unsubscribes", and until
// this branch the code had no route, no token and no way out — the promise was ahead of the
// codebase. These tests pin the four things that make it true: the link works, it works twice, it
// tells nobody anything about whose address it names, and reading it changes nothing — only `POST`
// removes an address, because a mail gateway that fetches every URL in a message must not be able
// to unsubscribe the person it is protecting.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_SECRET_LENGTH,
  UNSUBSCRIBE_SECRET_VAR,
  mintUnsubscribeToken,
} from '@/lib/email-token';
import {
  SEND_LOG_TABLE,
  claimSend,
  confirmSend,
  unresolvedClaims,
  waitlistRecipients,
  type Query,
} from '@/lib/waitlist-email-log';

const SECRET = 'z'.repeat(MIN_SECRET_LENGTH);
const ADDRESS = 'someone@example.com';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...args: unknown[]) => query(...args) }),
}));

/** Every statement issued, whitespace collapsed, in order. */
function statements(): string[] {
  return query.mock.calls.map((call) => String(call[0] ?? '').replace(/\s+/g, ' ').trim());
}

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  process.env[UNSUBSCRIBE_SECRET_VAR] = SECRET;
  process.env['PROJECTX_DATABASE_URL'] = 'postgres://example/does-not-connect';
});

afterEach(() => {
  vi.resetModules();
  delete process.env[UNSUBSCRIBE_SECRET_VAR];
  delete process.env['PROJECTX_DATABASE_URL'];
});

function link(token: string): string {
  return `https://weir.social/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function get(url: string): Promise<Response> {
  const { GET } = await import('@/app/unsubscribe/route');
  return GET(new Request(url));
}

async function post(url: string): Promise<Response> {
  const { POST } = await import('@/app/unsubscribe/route');
  return POST(new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click' }));
}

describe('the store forgets an address and says nothing about it', () => {
  it('deletes the row by its primary key and returns nothing', async () => {
    const { forgetAddress } = await import('@/lib/waitlist-unsubscribe');
    const result = await forgetAddress(ADDRESS);

    expect(result).toBeUndefined();
    expect(statements()).toEqual(['DELETE FROM waitlist_signups WHERE email = $1']);
    expect(query.mock.calls[0]?.[1]).toEqual([ADDRESS]);
  });

  it('is the same call whether a row was there or not', async () => {
    const { forgetAddress } = await import('@/lib/waitlist-unsubscribe');

    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(forgetAddress(ADDRESS)).resolves.toBeUndefined();

    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(forgetAddress(ADDRESS)).resolves.toBeUndefined();

    // Two identical statements: nothing in the code branches on whether the address existed.
    const issued = statements();
    expect(issued).toHaveLength(2);
    expect(issued[0]).toBe(issued[1]);
  });
});

describe('GET reads, and changes nothing', () => {
  /*
    This is the property the whole split exists for. RFC 8058 Section 1 says anti-spam software
    fetches the resources in mail header fields automatically, and the same URL is in the
    `List-Unsubscribe` header and in both bodies. If `GET` removed the row, a recipient's own mail
    gateway would take them off the list before they opened the message, with nothing anywhere able
    to tell that removal from a real one.
  */
  it('issues no statement at all for a valid link', async () => {
    const response = await get(link(mintUnsubscribeToken(ADDRESS, SECRET)));

    expect(response.status).toBe(200);
    expect(query).not.toHaveBeenCalled();
    expect(statements()).toEqual([]);
  });

  it('stays read-only however many times the link is fetched', async () => {
    const token = mintUnsubscribeToken(ADDRESS, SECRET);
    await get(link(token));
    await get(link(token));
    await get(link(token));

    expect(query).not.toHaveBeenCalled();
  });

  it('renders one button that posts the same token back to the same path', async () => {
    const token = mintUnsubscribeToken(ADDRESS, SECRET);
    const response = await get(link(token));
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');

    expect(body).toContain(`<form method="post" action="/unsubscribe?token=${encodeURIComponent(token)}">`);
    expect(body).toContain('<button type="submit">');
    // Nothing has happened yet, and the page has to say so rather than imply it.
    expect(body).toContain('Nothing has been changed yet');
    expect(body).not.toContain('You are off the list');
    // The page never names the reader. A forwarded link must disclose nothing.
    expect(body).not.toContain(ADDRESS);
    // A plain form: no script runs, so the button works in any client that renders HTML.
    expect(body).not.toContain('<script');
  });

  it('answers the same page whether or not the address is on the list', async () => {
    /*
      `GET` cannot vary on membership, because it never asks. Two fetches under different fake
      database answers must still be byte-identical — which they are by construction, since neither
      reaches the database.
    */
    const token = mintUnsubscribeToken(ADDRESS, SECRET);

    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const first = await get(link(token));
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const second = await get(link(token));

    expect(await first.text()).toBe(await second.text());
  });
});

describe('POST takes a real link off the list', () => {
  it('answers a page and deletes the row the token names', async () => {
    const response = await post(link(mintUnsubscribeToken(ADDRESS, SECRET)));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');

    expect(statements()).toEqual(['DELETE FROM waitlist_signups WHERE email = $1']);
    expect(query.mock.calls[0]?.[1]).toEqual([ADDRESS]);

    const body = await response.text();
    expect(body).toContain('off the list');
    // The page never names the reader. A forwarded link must disclose nothing.
    expect(body).not.toContain(ADDRESS);
  });

  it('answers identically the second time, and the tenth', async () => {
    /*
      Idempotence is not a nicety here. A second press and a forwarded link both arrive at a row
      that is already gone, and every one of them means the same thing to the person who sent the
      request.
    */
    const token = mintUnsubscribeToken(ADDRESS, SECRET);

    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const first = await post(link(token));
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const second = await post(link(token));
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const third = await post(link(token));

    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
    const bodies = await Promise.all([first.text(), second.text(), third.text()]);
    // Byte-identical: the answer carries no trace of whether there was a row to remove.
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);
  });

  it('honours the RFC 8058 one-click body a provider sends', async () => {
    /*
      What a mail provider's own unsubscribe button does: `POST` with
      `List-Unsubscribe=One-Click` as the body. The body is not read — the token is the whole of
      the request's authority — so this must work exactly as the form's own post does.
    */
    const { POST } = await import('@/app/unsubscribe/route');
    const token = mintUnsubscribeToken(ADDRESS, SECRET);
    const response = await POST(
      new Request(link(token), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    );

    expect(response.status).toBe(200);
    expect(statements()).toEqual(['DELETE FROM waitlist_signups WHERE email = $1']);
    expect(query.mock.calls[0]?.[1]).toEqual([ADDRESS]);
    expect(await response.text()).toContain('off the list');
  });

  it('removes the address on a token taken out of the page GET rendered', async () => {
    /*
      The round trip the reader actually makes: fetch the link, press the button, and the token in
      the form's action is the one that arrives. It is minted in the route rather than echoed out
      of the query string, so this pins that the minted one still verifies.
    */
    const rendered = await (await get(link(mintUnsubscribeToken(ADDRESS, SECRET)))).text();
    const action = /<form method="post" action="([^"]+)">/.exec(rendered)?.[1];
    expect(action).toBeDefined();

    const response = await post(`https://weir.social${action}`);

    expect(response.status).toBe(200);
    expect(statements()).toEqual(['DELETE FROM waitlist_signups WHERE email = $1']);
    expect(query.mock.calls[0]?.[1]).toEqual([ADDRESS]);
  });
});

describe('the route refuses anything it did not sign, before it touches the database', () => {
  it('refuses a tampered token and reads nothing', async () => {
    const token = mintUnsubscribeToken(ADDRESS, SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    const response = await get(link(tampered));

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(await response.text()).toContain('not valid');
  });

  it('refuses a tampered token on the acting verb too, before Postgres', async () => {
    /*
      Both verbs run the same check, and `POST` is the one that would write. A forged token must
      not reach the delete, so this is pinned on the verb that does the work rather than only on
      the one that does not.
    */
    const token = mintUnsubscribeToken(ADDRESS, SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    const response = await post(link(tampered));

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(await response.text()).toContain('not valid');
  });

  it('refuses a POST with no token, whatever the one-click body says', async () => {
    const { POST } = await import('@/app/unsubscribe/route');
    const response = await POST(
      new Request('https://weir.social/unsubscribe', {
        method: 'POST',
        body: 'List-Unsubscribe=One-Click',
      }),
    );

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a token minted under another secret', async () => {
    const foreign = mintUnsubscribeToken(ADDRESS, 'q'.repeat(MIN_SECRET_LENGTH));
    const response = await get(link(foreign));

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a link with no token at all', async () => {
    const response = await get('https://weir.social/unsubscribe');
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('says it could not act, rather than that the link is bad, when the secret is missing', async () => {
    /*
      A deployment fault is not the reader's fault. Their link is good and will work once the
      variable is set, so telling them it is invalid would send them away for good over an
      environment variable.
    */
    delete process.env[UNSUBSCRIBE_SECRET_VAR];
    const response = await get(link('anything.at-all'));

    expect(response.status).toBe(503);
    expect(query).not.toHaveBeenCalled();
    const body = await response.text();
    expect(body).toContain('could not take you off');
    expect(body).not.toContain('You are off the list');
    // And no button either: a page that cannot honour the press must not offer one.
    expect(body).not.toContain('<form');
  });

  it('refuses when the deployment has no list, without showing a button it cannot honour', async () => {
    delete process.env['PROJECTX_DATABASE_URL'];
    const response = await get(link(mintUnsubscribeToken(ADDRESS, SECRET)));

    expect(response.status).toBe(503);
    expect(query).not.toHaveBeenCalled();
    const body = await response.text();
    expect(body).toContain('could not take you off');
    expect(body).not.toContain('<form');
  });

  it('never reports a removal that failed, and never quotes the database', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('relation "waitlist_signups" does not exist'), { code: '42P01' }),
    );

    const response = await post(link(mintUnsubscribeToken(ADDRESS, SECRET)));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('could not take you off');
    expect(body).not.toContain('waitlist_signups');
    expect(body).not.toContain('42P01');
  });
});

describe('the send log is what makes a second copy impossible', () => {
  /** A fake `pool.query` that hands back whatever the test lines up. */
  function fakeQuery(results: Array<{ rows: unknown[] }>): { run: Query; seen: unknown[][] } {
    const seen: unknown[][] = [];
    let at = 0;
    const run = (async (text: string, params: readonly unknown[]) => {
      seen.push([text.replace(/\s+/g, ' ').trim(), params]);
      const next = results[at];
      at += 1;
      return next ?? { rows: [] };
    }) as Query;
    return { run, seen };
  }

  it('claims an address with one statement that cannot race', async () => {
    const { run, seen } = fakeQuery([{ rows: [{ email: ADDRESS }] }]);
    const outcome = await claimSend(run, {
      email: ADDRESS,
      templateId: 'waitlist-1',
      claimedAtMs: 1_700_000_000_000,
    });

    expect(outcome).toBe('claimed');
    const sql = String(seen[0]?.[0]);
    expect(sql).toContain(`INSERT INTO ${SEND_LOG_TABLE}`);
    /*
      The conflict target is the table's primary key, and the two have to agree or the guard is a
      statement that throws instead of one that refuses. Read out of the migration rather than
      remembered.
    */
    expect(sql).toContain('ON CONFLICT (email, template_id) DO NOTHING');
    expect(sql).toContain('RETURNING email');
    expect(seen[0]?.[1]).toEqual([ADDRESS, 'waitlist-1', 1_700_000_000_000]);
  });

  it('reports the second attempt as already sent, from zero returned rows and nothing else', async () => {
    const { run } = fakeQuery([{ rows: [] }]);
    await expect(
      claimSend(run, { email: ADDRESS, templateId: 'waitlist-1', claimedAtMs: 1 }),
    ).resolves.toBe('already-sent');
  });

  it('writes the provider id only where there is not one already', async () => {
    const { run, seen } = fakeQuery([{ rows: [] }]);
    await confirmSend(run, {
      email: ADDRESS,
      templateId: 'waitlist-1',
      providerMessageId: 'msg_1',
      sentAtMs: 2,
    });
    const sql = String(seen[0]?.[0]);
    expect(sql).toContain(`UPDATE ${SEND_LOG_TABLE}`);
    expect(sql).toContain('provider_message_id IS NULL');
  });

  it('names the claims that never came back with an id', async () => {
    const { run, seen } = fakeQuery([{ rows: [{ email: ADDRESS }] }]);
    await expect(unresolvedClaims(run, 'waitlist-1')).resolves.toEqual([ADDRESS]);
    expect(String(seen[0]?.[0])).toContain('provider_message_id IS NULL');
  });

  it('reads the list oldest first', async () => {
    const { run, seen } = fakeQuery([{ rows: [{ email: 'a@b.co' }, { email: 'c@d.co' }] }]);
    await expect(waitlistRecipients(run)).resolves.toEqual(['a@b.co', 'c@d.co']);
    expect(String(seen[0]?.[0])).toContain('ORDER BY created_at_ms ASC');
  });
});

describe('the migration and the code agree about the table', () => {
  it('declares the primary key the guard conflicts on', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'db', '042_waitlist_email_sends.sql'),
      'utf8',
    ).replace(/\s+/g, ' ');

    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${SEND_LOG_TABLE}`);
    expect(sql).toContain('PRIMARY KEY (email, template_id)');
    // The same closure `014` and `029` put on every other table holding addresses.
    expect(sql).toContain(`ALTER TABLE ${SEND_LOG_TABLE} ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain(`REVOKE ALL ON ${SEND_LOG_TABLE} FROM anon`);
  });
});
