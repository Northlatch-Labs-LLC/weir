// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * What can be checked about zkLogin without a Google project.
 *
 * Run: `pnpm tsx scripts/verify-zklogin.ts`
 *
 * The unit suite covers the pure logic. This covers the parts that need the network: that the
 * epoch a session is bound to comes from the chain, and — the important one — that the token
 * verifier actually refuses a token this machine made up. That check is the only thing standing
 * between a stranger and another user's salt, so it is worth exercising against the real Google
 * key set rather than a mock that returns whatever the test wants.
 */

import { createHash, generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { createClient, readCurrentEpoch } from '@projectx-social/sdk';
import { loadConfig } from '@projectx-social/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { generateNonce, generateRandomness, getExtendedEphemeralPublicKey } from '@mysten/sui/zklogin';
import { buildAuthUrl, maxEpochFrom } from '../lib/zklogin';
import { deriveUserSalt, verifyGoogleIdToken, zkLoginConfig } from '../lib/zklogin-server';

const tick = (text: string) => console.log(`  ✓ ${text}`);
const cross = (text: string) => console.log(`  ✗ ${text}`);
const info = (text: string) => console.log(`  · ${text}`);

let failures = 0;
function expect(condition: boolean, description: string): void {
  if (condition) tick(description);
  else {
    cross(description);
    failures += 1;
  }
}

/** A JWT signed by a key this process just generated. Google has never seen it. */
function forgeToken(payload: Record<string, unknown>): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = `${b64({ alg: 'RS256', kid: 'forged' })}.${b64(payload)}`;
  const signature = nodeSign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
  return `${head}.${signature}`;
}

async function main(): Promise<void> {
  console.log('\nzkLogin — what can be verified here\n');

  // ---------------------------------------------------------------- configuration
  console.log('Configuration');
  const configured = zkLoginConfig();
  if (configured.ok) {
    tick('zkLogin is configured on this deployment');
    info(`client id  ${configured.value.googleClientId}`);
    info(`redirect   ${configured.value.redirectUri}`);
    info(`prover     ${configured.value.proverUrl}`);
    // Never printed. Its digest is enough to tell two deployments apart in a log without putting
    // the value that derives every address into one.
    info(`seed       ${createHash('sha256').update(configured.value.seed).digest('hex').slice(0, 16)}… (sha256 prefix)`);
  } else {
    info(`not configured: ${configured.failure.detail}`);
    info('The sign-in panel will offer wallets only. That is the designed behaviour, not a fault.');
  }

  // ---------------------------------------------------------------- the epoch bound
  console.log('\nSession bound');
  const site = loadConfig(process.env as Record<string, string | undefined>);
  if (!site.ok) {
    cross(`chain config: ${site.failure.detail}`);
    failures += 1;
  } else {
    const epoch = await readCurrentEpoch(createClient(site.value));
    if (!epoch.ok) {
      cross(`could not read the epoch: ${epoch.failure.detail}`);
      failures += 1;
    } else {
      const max = maxEpochFrom(epoch.value);
      expect(max.ok, 'maxEpoch derives from the chain epoch, not a clock');
      if (max.ok) {
        info(`current epoch ${epoch.value} → sessions expire after ${max.value}`);
      }
    }
  }

  // ---------------------------------------------------------------- the security boundary
  console.log('\nToken verification (the only thing protecting the salt)');
  const clientId = configured.ok ? configured.value.googleClientId : 'test-client-id';

  /*
    A real commitment, because the verifier derives the nonce rather than being told it.

    It used to be handed `expectedNonce: 'N'` alongside a token carrying `nonce: 'N'`, which is
    precisely the shape the production callers had: the expected value came from the same place as
    the token. That parameter no longer exists.
  */
  const ephemeral = Ed25519Keypair.generate();
  const jwtRandomness = generateRandomness();
  const maxEpoch = 1222;
  const commitment = {
    extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(ephemeral.getPublicKey()),
    maxEpoch,
    jwtRandomness,
  };
  const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, jwtRandomness);

  const forged = await verifyGoogleIdToken({
    jwt: forgeToken({
      iss: 'https://accounts.google.com',
      aud: clientId,
      sub: 'victim-account',
      nonce,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    clientId,
    commitment,
  });
  expect(
    !forged.ok,
    'a token signed by a key Google never issued is refused (so a stranger cannot ask for another user’s salt)',
  );
  if (!forged.ok) info(`reason: ${forged.failure.detail.slice(0, 90)}`);

  const garbage = await verifyGoogleIdToken({
    jwt: 'not.a.jwt',
    clientId,
    commitment,
  });
  expect(!garbage.ok, 'a malformed token is refused rather than throwing');

  // ---------------------------------------------------------------- derivation
  console.log('\nSalt derivation');
  const seed = new Uint8Array(32).fill(3);
  const one = deriveUserSalt({ seed, iss: 'https://accounts.google.com', aud: 'a', sub: 'u1' });
  const two = deriveUserSalt({ seed, iss: 'https://accounts.google.com', aud: 'a', sub: 'u2' });
  expect(one === deriveUserSalt({ seed, iss: 'https://accounts.google.com', aud: 'a', sub: 'u1' }),
    'the same user derives the same salt every time');
  expect(one !== two, 'two users derive different salts');
  expect(one < 2n ** 128n, 'the salt fits the field element the circuit takes');

  // ---------------------------------------------------------------- the URL
  console.log('\nAuthorization URL');
  const url = new URL(buildAuthUrl({ clientId, redirectUri: 'https://example/cb', nonce: 'N' }));
  expect(url.searchParams.get('response_type') === 'id_token',
    'implicit flow — the token returns in the fragment, which browsers do not send to servers');
  expect(url.searchParams.get('scope') === 'openid',
    'asks for identity only — no profile, no email, no API access');

  // ---------------------------------------------------------------- honest gaps
  console.log('\nNot verified here, and why');
  info('A real Google sign-in — needs an OAuth client id from the operator’s own Google Cloud project.');
  info('A real proof — the mainnet prover requires Enoki allowlisting, or a self-hosted one.');
  info('Both are operator credentials. Nothing in this repository can stand in for them.');

  console.log(
    failures === 0
      ? '\nEverything checkable here passed.\n'
      : `\n${failures} check(s) failed.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
