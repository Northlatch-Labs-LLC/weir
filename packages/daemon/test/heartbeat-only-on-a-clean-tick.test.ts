// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const begin = vi.fn();
const abandon = vi.fn();
const finish = vi.fn();
const anchorAudit = vi.fn();
const discoverVaults = vi.fn();
const tick = vi.fn();

vi.mock('../src/adapters/discovery.js', () => ({
  discoverVaults: (...a: unknown[]) => discoverVaults(...a),
}));
vi.mock('../src/engine.js', () => ({ tick: (...a: unknown[]) => tick(...a) }));

vi.mock('../src/adapters/journal.js', () => ({
  openJournal: async () => ({
    ok: true,
    value: {
      begin: (...a: unknown[]) => begin(...a),
      finish: (...a: unknown[]) => finish(...a),
      abandon: (...a: unknown[]) => abandon(...a),
      anchorAudit: (...a: unknown[]) => anchorAudit(...a),
      stuckRuns: async () => ({ ok: true, value: [] }),
      close: async () => undefined,
    },
  }),
}));

vi.mock('@mysten/sui/grpc', () => ({
  SuiGrpcClient: class {
    async getBalance() {
      return { balance: { balance: '1000000000000' } };
    }
  },
}));

const SIGNER = `0x${'ab'.repeat(32)}`;

vi.mock('../src/adapters/signer.js', () => ({
  createSigner: () => ({
    ok: true,
    value: {
      address: SIGNER,
      auditHead: () => ({ headHash: '0'.repeat(64), entries: 0, intact: true }),
    },
  }),
}));

vi.mock('../src/config.js', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    loadDaemonConfig: () => ({
      ok: true,
      value: {
        grpcUrl: 'https://example.invalid',
        packageId: `0x${'11'.repeat(32)}`,
        maxDiscoveryPages: 1,
        gasBudgetMist: 1000n,
        latestPackageId: `0x${'11'.repeat(32)}`,
        journalUrl: 'postgres://x/y',
        intervalMs: 1,
        tickIntervalSeconds: 1,
      },
    }),
    assertJournalConfigured: () => ({ ok: true, value: 'postgres://x/y' }),
    assertSignerConfigured: () => ({ ok: true, value: 'secret' }),
    assertSignerFunded: () => ({ ok: true, value: true }),
  };
});

const { main } = await import('../src/index.js');

const HEARTBEAT = 'https://uptime.example/heartbeat/abc';
const fetchSpy = vi.fn();

beforeEach(() => {
  finish.mockResolvedValue({ ok: true, value: undefined });
  abandon.mockResolvedValue({ ok: true, value: true });
  anchorAudit.mockResolvedValue({ ok: true, value: true });
  fetchSpy.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function env(heartbeat: string): NodeJS.ProcessEnv {
  return { PROJECTX_DAEMON_HEARTBEAT_URL: heartbeat } as NodeJS.ProcessEnv;
}

describe('the heartbeat means "a tick succeeded", and nothing else', () => {
  it('pings once on a clean tick', async () => {
    begin.mockResolvedValue({ ok: true, value: { id: 'run-1' } });
    discoverVaults.mockResolvedValue({ ok: true, value: { vaults: [], truncated: false } });
    tick.mockResolvedValue({
      ok: true,
      value: { epoch: 1n, harvested: [], skipped: [], failed: [], truncated: false },
      observedAtMs: 1,
    });

    await main(['--once'], env(HEARTBEAT));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(HEARTBEAT, expect.objectContaining({ method: 'POST' }));
  });

  it('does not ping when the tick failed', async () => {
    begin.mockResolvedValue({ ok: true, value: { id: 'run-1' } });
    discoverVaults.mockResolvedValue({ ok: true, value: { vaults: [], truncated: false } });
    tick.mockResolvedValue({
      ok: false,
      failure: { kind: 'transport', detail: 'fullnode unreachable' },
      observedAtMs: 1,
    });

    await main(['--once'], env(HEARTBEAT));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not ping when the journal would not open a run', async () => {
    begin.mockResolvedValue({ ok: false, failure: { kind: 'transport', detail: 'db is down' } });

    await main(['--once'], env(HEARTBEAT));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing at all when no heartbeat is configured', async () => {
    begin.mockResolvedValue({ ok: true, value: { id: 'run-1' } });
    discoverVaults.mockResolvedValue({ ok: true, value: { vaults: [], truncated: false } });
    tick.mockResolvedValue({
      ok: true,
      value: { epoch: 1n, harvested: [], skipped: [], failed: [], truncated: false },
      observedAtMs: 1,
    });

    await main(['--once'], {} as NodeJS.ProcessEnv);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets an unreachable monitor fail without failing the harvest', async () => {
    begin.mockResolvedValue({ ok: true, value: { id: 'run-1' } });
    discoverVaults.mockResolvedValue({ ok: true, value: { vaults: [], truncated: false } });
    tick.mockResolvedValue({
      ok: true,
      value: { epoch: 1n, harvested: [], skipped: [], failed: [], truncated: false },
      observedAtMs: 1,
    });
    fetchSpy.mockRejectedValue(new Error('monitor unreachable'));

    const code = await main(['--once'], env(HEARTBEAT));

    expect(code).toBe(0);
    expect(anchorAudit).toHaveBeenCalled();
  });
});
