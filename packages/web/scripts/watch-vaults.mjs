// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createClient, loadConfig, readPlatform, fold } from '@projectx-social/sdk';

const cfg = loadConfig(process.env);
if (!cfg.ok) { console.error(cfg.failure); process.exit(1); }
const client = createClient(cfg.value);

const read = async () =>
  fold(await readPlatform(client, cfg.value), (p) => p, () => null);

const first = await read();
if (first === null) { console.error('could not read the platform object'); process.exit(1); }

const baseline = Number(process.argv[2] ?? first.vaultsCreated);
const target = Number(process.argv[3] ?? 50);
let last = Number(first.vaultsCreated);
let lastFee = String(first.creationFeeMist);

console.log(`watching. baseline ${baseline} vaults, target ${baseline + target}, fee ${lastFee} mist`);
console.log('a line appears only when something changes.\n');

for (;;) {
  await new Promise((r) => setTimeout(r, 30_000));
  const p = await read();
  if (p === null) continue;

  const now = Number(p.vaultsCreated);
  const fee = String(p.creationFeeMist);
  const stamp = new Date().toISOString().slice(11, 19);

  if (fee !== lastFee) {
    console.log(`${stamp}  FEE CHANGED  ${lastFee} -> ${fee} mist`);
    lastFee = fee;
  }
  if (now !== last) {
    const made = now - baseline;
    const jump = now - last;
    console.log(`${stamp}  vaults ${now}  (+${jump})  ${made}/${target} of the offer taken`);
    if (jump >= 3) console.log(`${stamp}  BURST: ${jump} vaults in 30s — this looks scripted, consider restoring the fee`);
    if (made >= target) console.log(`${stamp}  TARGET REACHED — ${made} vaults since baseline. Restore the fee.`);
    last = now;
  }
}
