// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const PORT = 4599;

const KEY_FILE = process.env['PROJECTX_TEST_WALLET_FILE'];
if (KEY_FILE === undefined || KEY_FILE.trim() === '') {
  console.error(
    'PROJECTX_TEST_WALLET_FILE is not set. Point it somewhere outside this repository, e.g.\n' +
      '  PROJECTX_TEST_WALLET_FILE=/tmp/projectx-test-wallet.json npx tsx scripts/test-wallet-signer.ts',
  );
  process.exit(1);
}

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
