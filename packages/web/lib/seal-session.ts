// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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

export function forgetSealSessions(): void {
  sessions.clear();
}
