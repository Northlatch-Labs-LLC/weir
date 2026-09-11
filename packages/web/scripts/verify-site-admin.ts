// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { isSiteAdmin } from '../lib/site-admin';

const OPERATOR = process.env['PROJECTX_SOCIAL_PUBLISHER_ADDRESS'] ?? '';
if (!/^0x[0-9a-fA-F]{64}$/.test(OPERATOR)) {
  console.error('set PROJECTX_SOCIAL_PUBLISHER_ADDRESS to the 0x address that published the package');
  process.exit(2);
}

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
