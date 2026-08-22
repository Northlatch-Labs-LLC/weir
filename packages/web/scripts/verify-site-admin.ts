// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * # Why this is a script and not a test
 *
 * `vitest.config.ts` says it plainly: unit tests only, because a suite that fails when a fullnode
 * is slow is a suite people learn to ignore. This asks a real node a real question, so it lives here
 * and is run deliberately.
 *
 * # What it is defending
 *
 * So this asserts both directions. An address that should administer, and one that should not.
 *
 *   pnpm verify:site-admin
 */

import { isSiteAdmin } from '../lib/site-admin';

/** The address that published this deployment's package. Read from the environment, never a literal. */
const OPERATOR = process.env['PROJECTX_SOCIAL_PUBLISHER_ADDRESS'] ?? '';
if (!/^0x[0-9a-fA-F]{64}$/.test(OPERATOR)) {
  console.error('set PROJECTX_SOCIAL_PUBLISHER_ADDRESS to the 0x address that published the package');
  process.exit(2);
}

/**
 * A real address that is not the publisher.
 *
 * Taken from a settled payment on this deployment rather than invented, so the negative case is a
 * genuine account with objects and history — an address that has never touched Sui would pass a
 * broken check for the wrong reason.
 */
const STRANGER = '0x7c7912f1227901d45387b4f8393f8c8d034801fee855f52550b09baefadf75b5';

async function main(): Promise<void> {
  const checks: Array<{ what: string; got: boolean; want: boolean }> = [
    { what: 'the publisher administers the site', got: await isSiteAdmin(OPERATOR), want: true },
    { what: 'a stranger does not', got: await isSiteAdmin(STRANGER), want: false },
    { what: 'nobody does', got: await isSiteAdmin(null), want: false },
  ];

  let failed = 0;
  for (const check of checks) {
    const ok = check.got === check.want;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.what}  (got ${check.got}, want ${check.want})`);
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed — do not ship the site switch in this state.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll checks passed against mainnet.');
}

await main();
