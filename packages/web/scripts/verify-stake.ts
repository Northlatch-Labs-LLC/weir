// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createClient, loadConfig, readStakePosition, readStakeVault, fold } from '@projectx-social/sdk';

const cfg = loadConfig(process.env);
if (!cfg.ok) { console.error(cfg.failure.detail); process.exit(1); }
const client = createClient(cfg.value);

const VAULT = '0xee64d87381e0056ec944af98a7a8a77a0de25652f4bee5e174df4b8b4f10bb11';
const DEPOSITOR = '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d';
const sui = (m: bigint) => (Number(m) / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '');

const vault = await readStakeVault(client, VAULT);
if (!vault.ok) { console.error('vault unreadable:', vault.failure.detail); process.exit(1); }
const v = vault.value;

console.log('creator        ', v.creator.slice(0, 18) + '…');
console.log('validator      ', v.validator.slice(0, 18) + '…');
console.log('accepting      ', v.accepting);
console.log('fee snapshot   ', v.feeBpsSnapshot.toString(), 'bps');
console.log('rebate to depos', v.rebateBps.toString(), 'bps');
console.log('total principal', sui(v.totalPrincipalMist), 'SUI');
console.log('  liquid       ', sui(v.liquidMist), 'SUI');
console.log('  staked       ', sui(v.tranches.reduce((a, t) => a + t.principalMist, 0n)), 'SUI in', v.tranches.length, 'tranche(s)');
console.log('lifetime yield ', sui(v.lifetimeYieldMist), 'SUI over', v.harvests.toString(), 'harvests');
console.log('creator yield  ', sui(v.creatorYieldMist), 'SUI unclaimed');
console.log('rebate pool    ', sui(v.rebatePoolMist), 'SUI');
console.log('positions table', v.positionsTableId);

const backing = v.liquidMist + v.tranches.reduce((a, t) => a + t.principalMist, 0n);
console.log('\nsolvent        ', backing >= v.totalPrincipalMist,
  `(backing ${sui(backing)} >= principal ${sui(v.totalPrincipalMist)})`);

const position = await readStakePosition(client, v.positionsTableId, DEPOSITOR);
fold(
  position,
  (p) => console.log('\ndepositor      ', p === null
    ? 'no position (a measured absence)'
    : `${sui(p.principalMist)} SUI principal, ${sui(p.pendingRebateMist)} SUI rebate accrued`),
  (f) => console.log('\ndepositor       NOT MEASURED —', f.detail),
);
