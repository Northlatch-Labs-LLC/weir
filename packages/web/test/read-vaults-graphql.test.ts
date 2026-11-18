// Built-by: @projectx.sui · Co-authored-by: Claude <no-reply@anthropic.com>
// The all-vaults walk reads StakeVaultOpened events through the GraphQL service because the gRPC
// event query on mainnet serves a recent window only — through it the walk SUCCEEDS with zero
// events and every pool on the site reads as absent. These tests hold the walk to the properties
// the index depends on: it pages full history by cursor, it never turns an unanswered question
// into an empty list, and it stops at a bound and says truncated rather than pretending
// completeness.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@projectx-social/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@projectx-social/sdk')>();
  return {
    ...actual,
    loadConfig: () => ({
      ok: true,
      value: { network: 'mainnet', packageId: '0xpkg', latestPackageId: '0xpkg2' },
    }),
  };
});

const { readVaults } = await import('@/lib/chain');

const ENDPOINT = 'https://graphql.example.invalid';
const ENV = 'PROJECTX_SOCIAL_GRAPHQL_URL';

const EVENT_TYPE = '0xpkg::stake_vault::StakeVaultOpened';

function opened(vault: string, creator: string, fee = '290') {
  return { contents: { json: { vault, creator, validator: '0xval', fee_bps_snapshot: fee } } };
}

function page(nodes: unknown[], { hasNextPage = false, endCursor = 'c' } = {}) {
  return {
    data: { events: { pageInfo: { hasNextPage, endCursor }, nodes } },
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env[ENV] = ENDPOINT;
});

afterEach(() => {
  delete process.env[ENV];
  vi.unstubAllGlobals();
});

describe('readVaults — the GraphQL event walk', () => {
  it('pages complete history by cursor and returns every vault', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page([opened('0xv1', '0xc1')], { hasNextPage: true, endCursor: 'cursor-1' })), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page([opened('0xv2', '0xc2', '500')])), { status: 200 }),
      );

    const reading = await readVaults();

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value.vaults).toEqual([
      { vaultId: '0xv1', creator: '0xc1', validator: '0xval', feeBpsSnapshot: 290n },
      { vaultId: '0xv2', creator: '0xc2', validator: '0xval', feeBpsSnapshot: 500n },
    ]);
    expect(reading.value.truncated).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as {
      variables: { type?: string; cursor?: string };
    };
    expect(second.variables.type).toBe(EVENT_TYPE);
    expect(second.variables.cursor).toBe('cursor-1');
  });

  it('REFUSES when the endpoint is unset — an empty list would be a value it did not observe', async () => {
    delete process.env[ENV];

    const reading = await readVaults();

    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.failure.kind).toBe('unconfigured');
    expect(reading.failure.detail).toContain(ENV);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails as transport when the endpoint answers non-200 or GraphQL errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    const badStatus = await readVaults();
    expect(badStatus.ok).toBe(false);
    if (badStatus.ok) return;
    expect(badStatus.failure.kind).toBe('transport');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: 'window exceeded' }] }), { status: 200 }),
    );
    const gqlError = await readVaults();
    expect(gqlError.ok).toBe(false);
    if (gqlError.ok) return;
    expect(gqlError.failure.kind).toBe('transport');
    expect(gqlError.failure.detail).toContain('window exceeded');
  });

  it('fails as malformed when an event does not carry the expected fields', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(page([{ contents: { json: { vault: '0xv1' } } }])), { status: 200 }),
    );

    const reading = await readVaults();

    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.failure.kind).toBe('malformed');
  });

  it('stops at its page bound and says truncated rather than implying completeness', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify(
          page([opened(`0xv${fetchMock.mock.calls.length}`, '0xc1')], { hasNextPage: true, endCursor: `c${fetchMock.mock.calls.length}` }),
        ),
        { status: 200 },
      ),
    );

    const reading = await readVaults();

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value.truncated).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(40);
  });
});
