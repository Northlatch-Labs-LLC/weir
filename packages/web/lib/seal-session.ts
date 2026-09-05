// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * One Seal session per signer per tab.
 *
 * # The cost this ends
 *
 * `SealedBody` and `SealedMedia` each created their own `SessionKey` and asked the wallet to sign
 * it. A feed with five paid posts the reader already owns was five wallet prompts on one page
 * load, and a post with three images was three more. The agent side (`seal-node.ts`) caches one
 * session per key; the browser did not.
 *
 * # What is shared, and what is not
 *
 * The session is a signed, time-limited statement that THIS address consents to key requests
 * against THIS package. It carries no entitlement — every decrypt still proves entitlement on
 * chain through `seal_approve_*` — so sharing it between cards changes nothing about who can open
 * what. It is keyed on `(address, packageId)` and lives until shortly before its TTL, then a
 * fresh one is created and signed once more.
 *
 * A creation that fails (the wallet refused, the package object could not be read) is dropped
 * from the cache, so the next card retries rather than inheriting a rejection.
 */
import { SessionKey } from '@mysten/seal';

export interface SessionSigner {
  address: string;
  signPersonalMessage: (message: Uint8Array) => Promise<string>;
}

interface Entry {
  key: Promise<SessionKey>;
  expiresAtMs: number;
}

const sessions = new Map<string, Entry>();

/** Renew this long before the TTL so a decrypt started near the end does not race the expiry. */
const RENEW_MARGIN_MS = 60_000;

export async function sessionKeyFor(input: {
  signer: SessionSigner;
  packageId: string;
  ttlMin: number;
  suiClient: Parameters<typeof SessionKey.create>[0]['suiClient'];
  now?: number;
}): Promise<SessionKey> {
  const now = input.now ?? Date.now();
  const id = `${input.signer.address.toLowerCase()}|${input.packageId.toLowerCase()}`;
  const held = sessions.get(id);
  if (held !== undefined && held.expiresAtMs - RENEW_MARGIN_MS > now) return held.key;

  const key = (async () => {
    const session = await SessionKey.create({
      address: input.signer.address,
      packageId: input.packageId,
      ttlMin: input.ttlMin,
      suiClient: input.suiClient,
    });
    const signature = await input.signer.signPersonalMessage(session.getPersonalMessage());
    await session.setPersonalMessageSignature(signature);
    return session;
  })();
  const entry: Entry = { key, expiresAtMs: now + input.ttlMin * 60_000 };
  sessions.set(id, entry);
  key.catch(() => {
    if (sessions.get(id) === entry) sessions.delete(id);
  });
  return key;
}

/** For tests and for a signer change: forget every session. */
export function forgetSealSessions(): void {
  sessions.clear();
}
