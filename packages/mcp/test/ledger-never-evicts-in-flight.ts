// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import assert from 'node:assert/strict';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CallLedger, MAX_ENTRIES, RESULT_TTL_MS } from '../src/idempotency.js';

let checks = 0;
let failures = 0;
function check(what: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`  ok  ${what}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${what}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

const result = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });

function pending(): { work: () => Promise<CallToolResult>; release: () => void; runs: number } {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const state = {
    runs: 0,
    release: (): void => release(),
    work: async (): Promise<CallToolResult> => {
      state.runs += 1;
      await gate;
      return result('bought');
    },
  };
  return state;
}

async function main(): Promise<void> {
  {
    const ledger = new CallLedger();
    const buy = pending();

    const first = ledger.once('buy-me', buy.work);
    for (let i = 0; i < MAX_ENTRIES + 8; i += 1) {
      await ledger.once(`filler-${i}`, async () => result(`f${i}`));
    }
    const retry = ledger.once('buy-me', buy.work);
    buy.release();
    await Promise.all([first, retry]);

    check('a concurrent retry joins the in-flight call rather than running it again', () => {
      assert.equal(buy.runs, 1, `the purchase ran ${buy.runs} times`);
    });
  }

  {
    const ledger = new CallLedger();
    const buy = pending();
    const first = ledger.once('buy-me', buy.work);
    for (let i = 0; i < MAX_ENTRIES + 8; i += 1) {
      await ledger.once(`filler-${i}`, async () => result(`f${i}`));
    }

    check('the in-flight entry is still held after the capacity rule has run', () => {
      assert.ok(ledger.size > 0, 'the ledger is empty');
    });

    buy.release();
    await first;
  }

  {
    let now = 1_000;
    const ledger = new CallLedger(() => now);
    const buy = pending();
    const first = ledger.once('buy-me', buy.work);

    now += RESULT_TTL_MS + 1;
    await ledger.once('anything', async () => result('x'));

    const retry = ledger.once('buy-me', buy.work);
    buy.release();
    await Promise.all([first, retry]);

    check('an in-flight call older than the TTL is not evicted either', () => {
      assert.equal(buy.runs, 1, `the purchase ran ${buy.runs} times after the TTL passed`);
    });
  }

  {
    let now = 1_000;
    const ledger = new CallLedger(() => now);
    await ledger.once('old', async () => result('old'));
    now += RESULT_TTL_MS + 1;
    await ledger.once('new', async () => result('new'));

    check('a SETTLED entry past its TTL is still evicted', () => {
      assert.equal(ledger.size, 1, `expected only the new entry, held ${ledger.size}`);
    });
  }

  {
    const ledger = new CallLedger();
    for (let i = 0; i < MAX_ENTRIES + 40; i += 1) {
      await ledger.once(`k-${i}`, async () => result(`v${i}`));
    }

    check('settled entries are still bounded by MAX_ENTRIES', () => {
      assert.ok(
        ledger.size <= MAX_ENTRIES,
        `the bound was abandoned for settled work: ${ledger.size}`,
      );
    });
  }

  console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('harness crashed:', error);
  process.exitCode = 1;
});
