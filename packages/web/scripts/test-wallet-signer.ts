// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * A local signing service that stands in for a wallet extension, so the browser UI can be driven
 * end to end.
 *
 * # What this is, precisely
 *
 * A **test double for the extension only.** It holds two Ed25519 keypairs and produces real Sui
 * signatures — the same bytes a wallet produces, verified by the same code the routes already use.
 * Nothing else is faked: the component, the crypto, the API routes, Postgres, the chain reads and
 * the signature checks are all the real ones.
 *
 * It exists because the browser pane has no wallet extension, and the alternative — asserting that
 * the page renders and calling that a test of the flow — would verify nothing about sending,
 * encrypting, decrypting or publishing a key.
 *
 * # The keys are random, and that is not fussiness
 *
 * This file first used fixed seeds — `new Uint8Array(32).fill(1)` and `fill(2)`. Those addresses
 * were funded with 0.06 SUI each on mainnet to exercise the key-publication flow, and **both were
 * emptied within thirty seconds** by a bot that already held the private keys. Mainnet is swept
 * continuously for weak keys; a well-known seed is a public address with a public key.
 *
 * So the keypairs are generated on first run and cached **outside the repository**, under the path
 * in `PROJECTX_TEST_WALLET_FILE`. Restarts keep the same addresses, so a funded test account stays
 * usable, and nothing signable is ever committed.
 *
 *   PROJECTX_TEST_WALLET_FILE=/tmp/projectx-test-wallet.json npx tsx scripts/test-wallet-signer.ts
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const PORT = 4599;

/**
 * Where the generated keys are cached. Required, with no default path inside the repository —
 * a default under the working tree is how a signable key ends up in a commit.
 */
const KEY_FILE = process.env['PROJECTX_TEST_WALLET_FILE'];
if (KEY_FILE === undefined || KEY_FILE.trim() === '') {
  console.error(
    'PROJECTX_TEST_WALLET_FILE is not set. Point it somewhere outside this repository, e.g.\n' +
      '  PROJECTX_TEST_WALLET_FILE=/tmp/projectx-test-wallet.json npx tsx scripts/test-wallet-signer.ts',
  );
  process.exit(1);
}

/** Generated once, then reused, so a funded test account survives a restart. */
const KEYS: Record<string, Ed25519Keypair> = (() => {
  if (existsSync(KEY_FILE)) {
    const stored = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(stored).map(([who, secret]) => [who, Ed25519Keypair.fromSecretKey(secret)]),
    );
  }
  const fresh = { alice: new Ed25519Keypair(), bob: new Ed25519Keypair() };
  writeFileSync(
    KEY_FILE,
    JSON.stringify(
      Object.fromEntries(Object.entries(fresh).map(([who, k]) => [who, k.getSecretKey()])),
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`generated new test keys in ${KEY_FILE}`);
  return fresh;
})();

const server = createServer((req, res) => {
  // The page is served from localhost:3000 and this listens on 4599, so every call is cross-origin.
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.url === '/accounts') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(KEYS).map(([who, k]) => [
            who,
            { address: k.toSuiAddress(), publicKey: k.getPublicKey().toBase64() },
          ]),
        ),
      ),
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/sign-tx') {
    // Transaction signing, for publishing an encryption key. Same keypair, different intent —
    // `signTransaction` wraps the bytes in the TransactionData intent rather than the personal
    // message one, and a wallet that confused the two would produce signatures that never verify.
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      void (async () => {
        try {
          const { who, txBytesB64 } = JSON.parse(raw) as { who: string; txBytesB64: string };
          const keypair = KEYS[who];
          if (keypair === undefined) throw new Error(`no such test account: ${who}`);
          const bytes = Uint8Array.from(Buffer.from(txBytesB64, 'base64'));
          const { signature } = await keypair.signTransaction(bytes);
          console.log(`signed a transaction for ${who} (${bytes.length} bytes)`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ signature }));
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      })();
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/sign') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      void (async () => {
        try {
          const { who, messageB64 } = JSON.parse(raw) as { who: string; messageB64: string };
          const keypair = KEYS[who];
          if (keypair === undefined) throw new Error(`no such test account: ${who}`);
          const bytes = Uint8Array.from(Buffer.from(messageB64, 'base64'));
          const { signature } = await keypair.signPersonalMessage(bytes);
          console.log(`signed for ${who}: ${new TextDecoder().decode(bytes).split('\n')[3] ?? ''}`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ signature }));
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      })();
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, '127.0.0.1', () => {
  for (const [who, k] of Object.entries(KEYS)) console.log(`${who}\t${k.toSuiAddress()}`);
  console.log(`\nlistening on http://127.0.0.1:${PORT}`);
});
