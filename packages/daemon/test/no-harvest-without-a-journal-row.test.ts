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
  createSigner: () => ({ ok: true, value: { address: SIGNER, auditHead: () => ({ headHash: '0'.repeat(64), entries: 0, intact: true }) } }),
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

beforeEach(() => {
  finish.mockResolvedValue({ ok: true, value: undefined });
  abandon.mockResolvedValue({ ok: true, value: true });
  anchorAudit.mockResolvedValue({ ok: true, value: true });
});

afterEach(() => vi.clearAllMocks());

describe('when the journal will not open a run', () => {
  it('does not harvest', async () => {
    begin.mockResolvedValue({ ok: false, failure: { kind: 'transport', detail: 'db is down' } });

    await main(['--once'], {} as NodeJS.ProcessEnv);

    expect(begin).toHaveBeenCalled();
    expect(discoverVaults).not.toHaveBeenCalled();
    expect(tick).not.toHaveBeenCalled();
  });

  it('exits non-zero, so a supervisor is not told the run succeeded', async () => {
    begin.mockResolvedValue({ ok: false, failure: { kind: 'transport', detail: 'db is down' } });

    const code = await main(['--once'], {} as NodeJS.ProcessEnv);

    expect(code).not.toBe(0);
  });
});

describe('when the journal opens a run', () => {
  it('harvests, which is what proves the guard is not simply refusing everything', async () => {
    begin.mockResolvedValue({ ok: true, value: { id: 'run-1' } });
    discoverVaults.mockResolvedValue({ ok: true, value: { vaults: [], truncated: false } });
    tick.mockResolvedValue({
      ok: true,
      value: { epoch: 1n, harvested: [], skipped: [], failed: [], truncated: false },
      observedAtMs: 1,
    });

    await main(['--once'], {} as NodeJS.ProcessEnv);

    expect(discoverVaults).toHaveBeenCalledTimes(1);
    expect(anchorAudit).toHaveBeenCalledTimes(1);
    expect(anchorAudit).toHaveBeenCalledWith(
      { id: 'run-1' },
      expect.objectContaining({ signer: SIGNER, headHash: '0'.repeat(64), entries: 0, intact: true }),
    );
    expect(anchorAudit.mock.invocationCallOrder[0]!).toBeGreaterThan(finish.mock.invocationCallOrder[0]!);
  });
});

describe('when the journal will not record that a run was abandoned', () => {
  it('says so, rather than leaving a row that reads as a crash', async () => {
    begin.mockResolvedValue({ ok: true, value: { id: 'run-1' } });
    discoverVaults.mockResolvedValue({
      ok: false,
      failure: { kind: 'transport', detail: 'node unreachable' },
    });
    abandon.mockResolvedValue({
      ok: false,
      failure: { kind: 'transport', detail: 'journal write failed' },
    });
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    await main(['--once'], {} as NodeJS.ProcessEnv);
    spy.mockRestore();

    expect(abandon).toHaveBeenCalledTimes(1);
    expect(errors.some((l) => l.includes('journalAbandon'))).toBe(true);
  });

  it('is silent about the abandon when it succeeds', async () => {
    begin.mockResolvedValue({ ok: true, value: { id: 'run-1' } });
    discoverVaults.mockResolvedValue({
      ok: false,
      failure: { kind: 'transport', detail: 'node unreachable' },
    });
    abandon.mockResolvedValue({ ok: true, value: true });
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    await main(['--once'], {} as NodeJS.ProcessEnv);
    spy.mockRestore();

    expect(abandon).toHaveBeenCalledTimes(1);
    expect(errors.some((l) => l.includes('journalAbandon'))).toBe(false);
  });
});
