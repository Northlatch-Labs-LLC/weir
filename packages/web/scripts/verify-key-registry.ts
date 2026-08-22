// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { createClient, loadConfig, loadKeyRegistryId, readKeyRegistryTableId, readPublishedKey, fold } from '@projectx-social/sdk';
const cfg = loadConfig(process.env); if (!cfg.ok) { console.error(cfg.failure); process.exit(1); }
const reg = loadKeyRegistryId(process.env); if (!reg.ok) { console.error(reg.failure); process.exit(1); }
const client = createClient(cfg.value);
const t = await readKeyRegistryTableId(client, reg.value);
if (!t.ok) { console.error('FAILED', t.failure); process.exit(1); }
console.log('registry', reg.value, 'table', t.value);
for (const [who, a] of Object.entries({
  alice: '0x830a8c0dbc3257d2e1c8b5c9f313678fb00ac69e7f9d1b78918461f7aa8654cd',
  bob:   '0xdc0e89ddb48abf1097c7c1f513e43167b5145c4b8c5011fdfb61833a2a6f2419',
})) {
  const k = await readPublishedKey(client, t.value, a);
  fold(k,
    (v) => console.log(who, v === null ? 'no key (measured absence)' : `key ${Buffer.from(v.x25519Public).toString('base64')} v${v.version}`),
    (f) => console.log(who, 'NOT MEASURED —', f.kind, f.detail));
}
