// Built-by: @projectx.sui · Co-authored-by: Claude
import { createClient, loadConfig, readRegistryTables, resolveHandle, handleOf, fold } from '@projectx-social/sdk';
const cfg = loadConfig(process.env); if (!cfg.ok) { console.error(cfg.failure); process.exit(1); }
const client = createClient(cfg.value);
const t = await readRegistryTables(client, cfg.value);
if (!t.ok) { console.error('FAILED', t.failure); process.exit(1); }
console.log('by_handle table ', t.value.byHandle);
console.log('by_address table', t.value.byAddress);
console.log('accounts        ', t.value.accounts.toString());
for (const h of ['projectx', 'suiladder', 'reader', 'definitely_free_handle']) {
  fold(await resolveHandle(client, t.value.byHandle, h),
    (a) => console.log(`handle ${h.padEnd(24)} ${a === null ? 'FREE (measured)' : 'taken by ' + a.slice(0,16) + '…'}`),
    (f) => console.log(`handle ${h.padEnd(24)} NOT MEASURED — ${f.detail}`));
}
for (const [who, a] of Object.entries({
  publisher: '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d',
  freshKey:  '0x830a8c0dbc3257d2e1c8b5c9f313678fb00ac69e7f9d1b78918461f7aa8654cd',
})) fold(await handleOf(client, t.value.byAddress, a),
  (h) => console.log(`addr   ${who.padEnd(24)} ${h === null ? 'no account (measured)' : '@' + h}`),
  (f) => console.log(`addr   ${who.padEnd(24)} NOT MEASURED — ${f.detail}`));
