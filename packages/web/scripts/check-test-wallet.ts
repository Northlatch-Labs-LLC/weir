// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createClient, loadConfig } from '@projectx-social/sdk';

export const TEST_WALLET =
  '0xcca238b159706d73736852e4b7b8975b43a28928aadd272bb32c3ece6934deb7';

const cfg = loadConfig(process.env);
if (!cfg.ok) { console.error(cfg.failure.detail); process.exit(1); }
const client = createClient(cfg.value) as any;

const balance = await client.core.getBalance({ owner: TEST_WALLET, coinType: '0x2::sui::SUI' });
const owned = await client.listOwnedObjects({ owner: TEST_WALLET, limit: 50 });
const mist = BigInt(balance.balance.balance);

console.log(`address  ${TEST_WALLET}`);
console.log(`balance  ${(Number(mist) / 1e9).toFixed(9)} SUI`);
console.log(`objects  ${(owned.objects ?? []).length}`);

for (const o of owned.objects ?? []) {
  console.log(`         ${String(o.type ?? '').split('::').slice(-2).join('::')}  ${o.objectId}`);
}

const ENOUGH = 50_000_000n;
console.log(mist >= ENOUGH ? '\nfunded — ready to sign' : `\nnot yet funded — needs about ${Number(ENOUGH) / 1e9} SUI`);
