// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export const EXIT = {
  ok: 0,
  misconfigured: 1,
  alreadyRunning: 2,
  runFailed: 3,
} as const;

export const SHUTDOWN_GRACE_MS = 30_000;

export interface Backoff {
  delayMs(): number;
  fail(): void;
  succeed(): void;
  failures(): number;
}

export function createBackoff(options: {
  baseMs: number;
  maxMs: number;
  random?: () => number;
}): Backoff {
  const random = options.random ?? Math.random;
  let failures = 0;

  return {
    failures: () => failures,
    fail: () => {
      failures += 1;
    },
    succeed: () => {
      failures = 0;
    },
    delayMs: () => {
      if (failures === 0) return options.baseMs;
      const exponent = Math.min(failures, 20);
      const ceiling = Math.min(options.baseMs * 2 ** exponent, options.maxMs);
      return Math.floor(random() * (ceiling - options.baseMs)) + options.baseMs;
    },
  };
}

export interface Shutdown {
  readonly requested: boolean;
  readonly promise: Promise<void>;
  dispose(): void;
}

export function installShutdown(
  process_: NodeJS.EventEmitter & { exit(code: number): never },
  signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'],
): Shutdown {
  let requested = false;
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  const onSignal = (signal: NodeJS.Signals) => {
    if (requested) {
      console.error(JSON.stringify({ shutdown: 'forced', signal }));
      process_.exit(EXIT.ok);
    }
    requested = true;
    console.log(JSON.stringify({ shutdown: 'requested', signal, graceMs: SHUTDOWN_GRACE_MS }));
    resolve();
  };

  const handlers = signals.map((signal) => {
    const handler = () => onSignal(signal);
    process_.on(signal, handler);
    return { signal, handler };
  });

  return {
    get requested() {
      return requested;
    },
    promise,
    dispose() {
      for (const { signal, handler } of handlers) process_.off(signal, handler);
    },
  };
}

export async function sleepUnlessShutdown(ms: number, shutdown: Shutdown): Promise<void> {
  if (shutdown.requested) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void shutdown.promise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function withDeadline<T>(
  work: Promise<T>,
  graceMs: number,
): Promise<{ finished: true; value: T } | { finished: false }> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<{ finished: false }>((resolve) => {
    timer = setTimeout(() => resolve({ finished: false }), graceMs);
  });
  try {
    return await Promise.race([work.then((value) => ({ finished: true as const, value })), expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
