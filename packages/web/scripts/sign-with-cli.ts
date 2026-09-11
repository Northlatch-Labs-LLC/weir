// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { execFileSync } from 'node:child_process';

const [address, url, payloadJson] = process.argv.slice(2);
if (address === undefined || url === undefined || payloadJson === undefined) {
  console.error('usage: sign-with-cli.ts <address> <prepare-url> <json>');
  process.exit(1);
}

const base = process.env['PROJECTX_WEB_URL'] ?? 'http://localhost:3000';

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
