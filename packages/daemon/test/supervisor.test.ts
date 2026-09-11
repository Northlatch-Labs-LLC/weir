// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createBackoff,
  EXIT,
  installShutdown,
  sleepUnlessShutdown,
  withDeadline,
} from '../src/supervisor.js';

describe('exit codes', () => {
  it('are distinct, because a supervisor branches on them', () => {
    const codes = Object.values(EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('reserves 0 for success only', () => {
    expect(EXIT.ok).toBe(0);
    for (const [name, code] of Object.entries(EXIT)) {
      if (name !== 'ok') expect(code).not.toBe(0);
    }
  });
});

describe('createBackoff', () => {
  const base = 1_000;
  const max = 60_000;

  it('waits exactly the base interval while nothing is failing', () => {
    const b = createBackoff({ baseMs: base, maxMs: max, random: () => 0.5 });
    expect(b.delayMs()).toBe(base);
    expect(b.failures()).toBe(0);
  });

  it('grows with consecutive failures', () => {
    const b = createBackoff({ baseMs: base, maxMs: max, random: () => 1 });
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      b.fail();
      seen.push(b.delayMs());
    }
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });

  it('never exceeds the cap, even after an absurd number of failures', () => {
    const b = createBackoff({ baseMs: base, maxMs: max, random: () => 1 });
    for (let i = 0; i < 500; i += 1) b.fail();
    expect(b.delayMs()).toBeLessThanOrEqual(max);
    expect(Number.isFinite(b.delayMs())).toBe(true);
  });

  it('never returns less than the base interval', () => {
    const b = createBackoff({ baseMs: base, maxMs: max, random: () => 0 });
    for (let i = 0; i < 10; i += 1) {
      b.fail();
      expect(b.delayMs()).toBeGreaterThanOrEqual(base);
    }
  });

  it('spreads retries instead of synchronising them', () => {
    const draws = [0.01, 0.99];
    const delays = draws.map((d) => {
      const b = createBackoff({ baseMs: base, maxMs: max, random: () => d });
      b.fail();
      b.fail();
      b.fail();
      return b.delayMs();
    });
    expect(delays[0]).not.toBe(delays[1]);
    expect(delays[1]! - delays[0]!).toBeGreaterThan(base);
  });

  it('returns to the base interval after a success', () => {
    const b = createBackoff({ baseMs: base, maxMs: max, random: () => 1 });
    for (let i = 0; i < 8; i += 1) b.fail();
    expect(b.delayMs()).toBeGreaterThan(base);
    b.succeed();
    expect(b.failures()).toBe(0);
    expect(b.delayMs()).toBe(base);
  });
});

function fakeProcess() {
  const emitter = new EventEmitter() as EventEmitter & { exit(code: number): never; exited: number[] };
  emitter.exited = [];
  emitter.exit = ((code: number) => {
    emitter.exited.push(code);
    return undefined as never;
  }) as never;
  return emitter;
}

describe('installShutdown', () => {
  it('records the request and resolves for anyone waiting', async () => {
    const p = fakeProcess();
    const shutdown = installShutdown(p, ['SIGTERM']);
    expect(shutdown.requested).toBe(false);

    p.emit('SIGTERM');
    await shutdown.promise;
    expect(shutdown.requested).toBe(true);
    expect(p.exited).toEqual([]);
    shutdown.dispose();
  });

  it('exits immediately on a second signal', () => {
    const p = fakeProcess();
    const shutdown = installShutdown(p, ['SIGTERM']);
    p.emit('SIGTERM');
    p.emit('SIGTERM');
    expect(p.exited).toEqual([EXIT.ok]);
    shutdown.dispose();
  });

  it('removes its handlers on dispose', () => {
    const p = fakeProcess();
    const shutdown = installShutdown(p, ['SIGTERM', 'SIGINT']);
    expect(p.listenerCount('SIGTERM')).toBe(1);
    shutdown.dispose();
    expect(p.listenerCount('SIGTERM')).toBe(0);
    expect(p.listenerCount('SIGINT')).toBe(0);
  });
});

describe('sleepUnlessShutdown', () => {
  it('returns at once when shutdown was already requested', async () => {
    const p = fakeProcess();
    const shutdown = installShutdown(p, ['SIGTERM']);
    p.emit('SIGTERM');

    const started = Date.now();
    await sleepUnlessShutdown(60_000, shutdown);
    expect(Date.now() - started).toBeLessThan(200);
    shutdown.dispose();
  });

  it('wakes early when the signal arrives mid-sleep', async () => {
    const p = fakeProcess();
    const shutdown = installShutdown(p, ['SIGTERM']);
    const started = Date.now();
    const sleeping = sleepUnlessShutdown(60_000, shutdown);
    setTimeout(() => p.emit('SIGTERM'), 20);
    await sleeping;
    expect(Date.now() - started).toBeLessThan(1_000);
    shutdown.dispose();
  });

  it('sleeps the full time when no signal arrives', async () => {
    const p = fakeProcess();
    const shutdown = installShutdown(p, ['SIGTERM']);
    const started = Date.now();
    await sleepUnlessShutdown(60, shutdown);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    shutdown.dispose();
  });
});

describe('withDeadline', () => {
  it('reports the value when the work finishes in time', async () => {
    const result = await withDeadline(Promise.resolve('done'), 1_000);
    expect(result).toEqual({ finished: true, value: 'done' });
  });

  it('reports unfinished when the deadline wins', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 5_000));
    const result = await withDeadline(slow, 30);
    expect(result.finished).toBe(false);
  });

  it('does not cancel the work it stopped waiting for', async () => {
    const finished = vi.fn();
    const slow = new Promise<void>((resolve) =>
      setTimeout(() => {
        finished();
        resolve();
      }, 60),
    );
    const result = await withDeadline(slow, 20);
    expect(result.finished).toBe(false);
    expect(finished).not.toHaveBeenCalled();

    await slow;
    expect(finished).toHaveBeenCalledOnce();
  });

  it('clears its timer so a fast tick does not hold the event loop open', async () => {
    const before = process.getActiveResourcesInfo?.().filter((r) => r === 'Timeout').length ?? 0;
    await withDeadline(Promise.resolve(1), 30_000);
    const after = process.getActiveResourcesInfo?.().filter((r) => r === 'Timeout').length ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  });
});
