// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * End-to-end verification of encrypted direct messages, through the real HTTP routes.
 *
 * The unit tests cover the crypto in isolation. This covers everything the unit tests cannot: that
 * the routes verify the signatures they claim to, that the database stores ciphertext and no
 * plaintext, that the refusals actually refuse, and that a message encrypted by one participant is
 * readable by the other after a full round trip through Postgres.
 *
 * It signs with real Ed25519 keypairs, so the signatures are the same kind a wallet produces. It
 * touches no chain state and spends nothing.
 *
 *   pnpm dev                                       # in another terminal
 *   npx tsx scripts/verify-e2e-messages.ts
 *
 * Exits non-zero on the first failure, with the response that caused it.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  ciphertextDigest,
  decrypt,
  encrypt,
  deriveSecret,
  publicFromSecret,
  toB64,
  KEY_STATEMENT,
  type EncryptedPayload,
} from '../lib/e2e';

const BASE = process.env['PROJECTX_WEB_URL'] ?? 'http://localhost:3000';

let passed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
    return;
  }
  console.error(`  FAIL ${name}`);
  if (detail !== undefined) console.error(`       ${JSON.stringify(detail)}`);
  process.exit(1);
}

/** A participant: a Sui keypair plus the X25519 key derived from its signature. */
async function participant(seed: number) {
  const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(seed));
  const address = keypair.toSuiAddress();

  const { signature } = await keypair.signPersonalMessage(new TextEncoder().encode(KEY_STATEMENT));
  const secret = deriveSecret(signature);

  /** Sign a statement exactly as `statementFor` will rebuild it. */
  const sign = async (action: string) => {
    const timestampMs = Date.now();
    const message = `ProjectX Social\naddress: ${address}\nissued: ${timestampMs}\n${action}`;
    const { signature: s } = await keypair.signPersonalMessage(new TextEncoder().encode(message));
    return { signature: s, timestampMs };
  };

  return { address, secret, x25519Public: toB64(publicFromSecret(secret)), sign };
}

type Participant = Awaited<ReturnType<typeof participant>>;

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

async function registerKey(p: Participant) {
  const signed = await p.sign(`action: register encryption key\nkey: ${p.x25519Public}`);
  return post('/api/keys', { address: p.address, x25519Public: p.x25519Public, ...signed });
}

async function sendEncrypted(from: Participant, to: Participant, text: string, override?: Partial<EncryptedPayload>) {
  const encryption = { ...encrypt(text, [
    { address: to.address, x25519Public: to.x25519Public },
    { address: from.address, x25519Public: from.x25519Public },
  ]), ...override };
  const signed = await from.sign(
    `action: send encrypted\nto: ${to.address}\nciphertext-sha256: ${ciphertextDigest(encryption.ciphertext)}`,
  );
  return post('/api/messages', { from: from.address, to: to.address, encryption, ...signed });
}

async function readThread(viewer: Participant, other: string) {
  const signed = await viewer.sign(`action: read\nthread with: ${other}`);
  return post('/api/messages/read', { viewer: viewer.address, other, ...signed });
}

async function main() {
  const alice = await participant(1);
  const bob = await participant(2);
  const mallory = await participant(3);

  console.log(`alice   ${alice.address}`);
  console.log(`bob     ${bob.address}`);
  console.log(`mallory ${mallory.address}\n`);

  console.log('key registry');
  check('alice registers her key', (await registerKey(alice)).json.registered === true);
  check('bob registers his key', (await registerKey(bob)).json.registered === true);

  {
    const forged = await post('/api/keys', {
      address: bob.address,
      x25519Public: mallory.x25519Public,
      ...(await mallory.sign(`action: register encryption key\nkey: ${mallory.x25519Public}`)),
    });
    // Mallory signs correctly, but for her own address and her own key, then claims Bob's address.
    // This is the substitution attack the self-certifying registration exists to stop.
    check('mallory cannot publish a key under bob\'s address', forged.status === 401, forged.json);
  }

  {
    const r = await post('/api/keys', {
      address: alice.address,
      x25519Public: toB64(new Uint8Array(16)),
      ...(await alice.sign(`action: register encryption key\nkey: ${toB64(new Uint8Array(16))}`)),
    });
    check('a 16-byte key is refused', r.status === 400, r.json);
  }

  {
    const r = await fetch(`${BASE}/api/keys?addresses=${alice.address},${mallory.address}`);
    const b = (await r.json()) as { keys: Record<string, string> };
    check('lookup returns alice', b.keys[alice.address.toLowerCase()] === alice.x25519Public);
    check(
      'lookup omits an address with no key rather than returning a blank',
      !(mallory.address.toLowerCase() in b.keys),
      b.keys,
    );
  }

  console.log('\nsending');
  const secretText = `harvest at epoch end — ${Date.now()}`;
  const sent = await sendEncrypted(alice, bob, secretText);
  check('alice sends an encrypted message', sent.status === 200, sent.json);

  console.log('\nreading');
  {
    const r = await readThread(bob, alice.address);
    const messages = r.json.messages as Array<{ body?: string; preview: string; encryption: EncryptedPayload | null }>;
    const last = messages[messages.length - 1];
    check('bob receives it', last !== undefined && last.encryption !== null, r.json);
    check('the server returned no body', last?.body === '', last);
    check('the server returned no preview', last?.preview === '', last);
    check(
      'bob decrypts it to the original text',
      decrypt(last!.encryption!, bob.address, bob.secret) === secretText,
    );
    check(
      'mallory\'s key does not open it',
      decrypt(last!.encryption!, bob.address, mallory.secret) === null,
    );
  }

  {
    const r = await readThread(alice, bob.address);
    const messages = r.json.messages as Array<{ encryption: EncryptedPayload | null }>;
    const last = messages[messages.length - 1];
    check(
      'alice can read back what she sent',
      decrypt(last!.encryption!, alice.address, alice.secret) === secretText,
    );
  }

  {
    // Mallory asks for her thread with Alice. The route derives the thread id from the two proven
    // addresses, so there is nothing to ask for.
    const r = await readThread(mallory, alice.address);
    check('mallory sees nothing of alice and bob', (r.json.messages as unknown[]).length === 0);
  }

  {
    const signed = await mallory.sign(`action: read\nthread with: ${bob.address}`);
    const r = await post('/api/messages/read', {
      viewer: alice.address, // claims to be Alice
      other: bob.address,
      ...signed, // signed by Mallory
    });
    check('a signature from the wrong key cannot read a thread', r.status === 401, r.json);
  }

  console.log('\nrefusals');
  {
    const encryption = encrypt('x', [
      { address: bob.address, x25519Public: bob.x25519Public },
      { address: alice.address, x25519Public: alice.x25519Public },
    ]);
    const signed = await alice.sign(
      `action: send encrypted\nto: ${bob.address}\nciphertext-sha256: ${ciphertextDigest(encryption.ciphertext)}`,
    );
    const r = await post('/api/messages', {
      from: alice.address, to: bob.address, encryption,
      paid: { price: '1000000', contentKey: 'k', handle: 'anyone' },
      ...signed,
    });
    check('encrypted and paid together is refused', r.status === 400, r.json);
  }

  {
    // Only the recipient's envelope. The sender would never be able to read her own message.
    const encryption = encrypt('x', [{ address: bob.address, x25519Public: bob.x25519Public }]);
    const signed = await alice.sign(
      `action: send encrypted\nto: ${bob.address}\nciphertext-sha256: ${ciphertextDigest(encryption.ciphertext)}`,
    );
    const r = await post('/api/messages', { from: alice.address, to: bob.address, encryption, ...signed });
    check('a missing sender envelope is refused', r.status === 400, r.json);
  }

  {
    const encryption = encrypt('x', [
      { address: bob.address, x25519Public: bob.x25519Public },
      { address: alice.address, x25519Public: alice.x25519Public },
      { address: mallory.address, x25519Public: mallory.x25519Public },
    ]);
    const signed = await alice.sign(
      `action: send encrypted\nto: ${bob.address}\nciphertext-sha256: ${ciphertextDigest(encryption.ciphertext)}`,
    );
    const r = await post('/api/messages', { from: alice.address, to: bob.address, encryption, ...signed });
    check('a silent extra recipient is refused', r.status === 400, r.json);
  }

  {
    // A signature over one ciphertext, submitted with a different one — the exact replay the
    // digest binding exists to stop.
    const real = encrypt('the real one', [
      { address: bob.address, x25519Public: bob.x25519Public },
      { address: alice.address, x25519Public: alice.x25519Public },
    ]);
    const swapped = encrypt('a substituted one', [
      { address: bob.address, x25519Public: bob.x25519Public },
      { address: alice.address, x25519Public: alice.x25519Public },
    ]);
    const signed = await alice.sign(
      `action: send encrypted\nto: ${bob.address}\nciphertext-sha256: ${ciphertextDigest(real.ciphertext)}`,
    );
    const r = await post('/api/messages', {
      from: alice.address, to: bob.address, encryption: swapped, ...signed,
    });
    check('a signature cannot be moved to a different ciphertext', r.status === 401, r.json);
  }

  {
    const signed = await alice.sign(
      `action: send encrypted\nto: ${bob.address}\nciphertext-sha256: ${ciphertextDigest('')}`,
    );
    const r = await post('/api/messages', {
      from: alice.address, to: bob.address,
      encryption: { ciphertext: '', nonce: 'x', envelopes: [] },
      ...signed,
    });
    check('an empty ciphertext is refused', r.status === 400, r.json);
  }

  console.log('\ninbox');
  {
    const signed = await bob.sign(`action: read\nthread with: ${bob.address}`);
    const r = await post('/api/messages/threads', { viewer: bob.address, ...signed });
    const threads = r.json.threads as Array<{ other: string; lastPreview: string; lastEncrypted: boolean }>;
    const thread = threads.find((t) => t.other === alice.address.toLowerCase());
    check('the thread appears in bob\'s inbox', thread !== undefined, threads);
    check('it is flagged encrypted', thread?.lastEncrypted === true, thread);
    check('and carries no preview text', thread?.lastPreview === '', thread);
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
