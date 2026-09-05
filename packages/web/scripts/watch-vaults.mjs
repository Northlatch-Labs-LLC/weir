// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Watch vault creation while the creation fee is open.
//
// `creation_fee_mist` is one global number with no counter attached: while it is zero, anybody can
// open unlimited vaults, and the fee is the only thing that makes bulk creation expensive. The
// "first fifty" is therefore enforced by watching, not by the contract. This is the watching.
//
//   node --env-file=.env.local scripts/watch-vaults.mjs [baseline] [target]
//
// Prints a line only when the count MOVES, plus a loud line at the target and at any burst that
// looks scripted rather than organic.
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
  if (p === null) continue; // A failed read is not a count. Say nothing rather than report a zero.

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
    // Three or more inside one 30s window is not a person deciding to become a creator.
    if (jump >= 3) console.log(`${stamp}  BURST: ${jump} vaults in 30s — this looks scripted, consider restoring the fee`);
    if (made >= target) console.log(`${stamp}  TARGET REACHED — ${made} vaults since baseline. Restore the fee.`);
    last = now;
  }
}
