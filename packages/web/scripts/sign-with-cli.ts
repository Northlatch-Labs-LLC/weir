// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Prepare through the application, sign with the Sui CLI, submit through the application.
 *
 * # Why the signing step is a shell out
 *
 * What that leaves proven is exactly what needed proving: the application BUILDS a transaction that
 * a real signer accepts, and SUBMITS bytes it did not rebuild. The bytes handed to the CLI are the
 * bytes that were simulated, and the bytes posted back are the same ones again — the middle step is
 * the only part that is not ours, and it is the part a user's wallet would perform.
 *
 *   npx tsx scripts/sign-with-cli.ts <address> <prepare-url> '<json payload>'
 */

import { execFileSync } from 'node:child_process';

const [address, url, payloadJson] = process.argv.slice(2);
if (address === undefined || url === undefined || payloadJson === undefined) {
  console.error('usage: sign-with-cli.ts <address> <prepare-url> <json>');
  process.exit(1);
}

const base = process.env['PROJECTX_WEB_URL'] ?? 'http://localhost:3000';

// --- 1. Prepare: the application builds and simulates. Nothing is signed here. ---
const prepared = await fetch(`${base}${url}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sender: address, ...(JSON.parse(payloadJson) as object) }),
});
const body = (await prepared.json()) as {
  quote?: { bytes: string; gasMist: string; amountMist: string };
  error?: string;
};
if (body.quote === undefined) {
  console.error(`prepare failed: ${body.error ?? prepared.status}`);
  process.exit(1);
}
console.log(`simulated  gas ${body.quote.gasMist} mist`);

// --- 2. Sign, in the tool that holds the key. ---
const signed = execFileSync(
  'sui',
  ['keytool', 'sign', '--address', address, '--data', body.quote.bytes, '--json'],
  { encoding: 'utf8' },
);
const signature = (JSON.parse(signed) as { suiSignature?: string }).suiSignature;
if (signature === undefined) {
  console.error('the CLI returned no signature');
  process.exit(1);
}

// --- 3. Submit the bytes that were simulated, unchanged. ---
const submitted = await fetch(`${base}/api/checkout/submit`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ bytes: body.quote.bytes, signature }),
});
const result = (await submitted.json()) as { digest?: string; error?: string };
if (result.digest === undefined) {
  console.error(`submit failed: ${result.error ?? submitted.status}`);
  process.exit(1);
}
console.log(`EXECUTED   ${result.digest}`);
