'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A paid post's words, opened in the reader's own tab.
 *
 * # Why this exists
 *
 * A gated body is no longer a column. It is ciphertext on Walrus, sealed to the same
 * `unlock_identity(vault, contentKey)` as the post's media, so the `Unlock` that opens the picture
 * opens the sentence under it. The server cannot render these words because it cannot read them —
 * which is the point, and is what Creator Terms §4.3 has claimed since the first commit.
 *
 * # Why it is not `SealedMedia` with a different content type
 *
 * `SealedMedia` fetches through `/api/media/…`, which resolves an *asset* row and re-checks
 * entitlement per request. A body is not an asset: it has no asset id, it is named by columns on
 * the post, and its ciphertext is fetched straight from a public Walrus aggregator. The reader
 * needs no permission to hold those bytes — they are unreadable — so there is no route to ask.
 *
 * The two components share everything that matters: the same identity derivation from the SDK, the
 * same key server, the same settling-window patience, and the same refusal to render bytes whose
 * hash does not match what the creator uploaded.
 */

import { useEffect, useState } from 'react';
import { SealClient, SessionKey } from '@mysten/seal';
import { createClient, type ProjectXSocialConfig } from '@projectx-social/sdk';

import { useSigner } from '@/components/SignerProvider';
import { PostBody } from '@/components/PostBody';
import { approvalFor, openBlob, sha256Hex } from '@/lib/seal-open';

export interface SealedBodyRef {
  blobId: string;
  nonce: string;
  sealWrappedKey: string;
  sha256: string;
}

/**
 * Which `seal_approve_*` opens this body, and the object it is judged against.
 *
 * Restated structurally rather than imported from `@/lib/entitlement`, which is `server-only`. The
 * shape is checked by the compiler at the one place the two meet — `PostCard` passes a
 * `SealApprover` straight into this prop — so they cannot drift silently.
 */
export type Approver =
  /** `contentKey` is the key the `Unlock` carries — the human key or `<key>#machine`. */
  | { kind: 'unlock'; objectId: string; contentKey: string }
  | { kind: 'subscription'; objectId: string; tier: string; period: string };

interface PublicKeyServer {
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
}

interface SealSettings {
  config: ProjectXSocialConfig | null;
  keyServers: PublicKeyServer[];
}

const SESSION_TTL_MIN = 10;
const SETTLING_ATTEMPTS = 4;
const SETTLING_BACKOFF_MS = [1500, 3500, 6000];

/**
 * Public Walrus read endpoints, tried in order.
 *
 * A blob is public, so this needs no credential and no route of ours. More than one is listed
 * because an aggregator being unreachable is a fact about that operator, not about the reader's
 * entitlement, and a paid post should not be unreadable because one public gateway is down.
 */
const AGGREGATORS = [
  'https://aggregator.walrus-mainnet.walrus.space',
  'https://walrus.globalstake.io',
];

let settingsRequest: Promise<SealSettings> | null = null;
function sealSettingsOnce(): Promise<SealSettings> {
  settingsRequest ??= fetch('/api/seal', { credentials: 'same-origin' })
    .then((r) => {
      if (!r.ok) throw new Error('could not read this deployment’s seal settings');
      return r.json() as Promise<SealSettings>;
    })
    .catch((e: unknown) => { settingsRequest = null; throw e; });
  return settingsRequest;
}

function looksLikeSettling(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /NoAccess|does not have access|InvalidParameter|NotFound|not yet exist/i.test(text);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; text: string }
  | { phase: 'needs-signer' }
  | { phase: 'settling' }
  | { phase: 'failed'; reason: string };

export function SealedBody({
  sealed, preview, vaultId, contentKey, approver,
}: {
  sealed: SealedBodyRef;
  preview: string;
  /** Every Seal identity in this system begins with the vault's bytes. */
  vaultId: string;
  /** The post's content key. Present on a paid post; a subscriber post has none and needs none. */
  contentKey?: string;
  /**
   * The entitlement this reader presents. Absent means they hold none that covers this post — for
   * a subscriber post that includes holding a live subscription which simply began after the
   * period this post was published in, which is the deliberate under-grant the contract makes.
   */
  approver?: Approver;
}) {
  const { signer } = useSigner();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (signer === null) { if (!cancelled) setState({ phase: 'needs-signer' }); return; }
        if (approver === undefined) {
          throw new Error('this post is not unlocked for you');
        }

        const { config, keyServers } = await sealSettingsOnce();
        if (cancelled) return;
        if (config === null || keyServers.length === 0) {
          throw new Error('this deployment has no key servers configured');
        }

        const suiClient = createClient(config);
        const sessionKey = await SessionKey.create({
          address: signer.address, packageId: config.packageId,
          ttlMin: SESSION_TTL_MIN, suiClient,
        });
        const signature = await signer.signPersonalMessage(sessionKey.getPersonalMessage());
        if (cancelled) return;
        await sessionKey.setPersonalMessageSignature(signature);

        const seal = new SealClient({
          suiClient,
          serverConfigs: keyServers.map((s) => ({
            objectId: s.objectId, weight: s.weight,
            ...(s.aggregatorUrl === undefined ? {} : { aggregatorUrl: s.aggregatorUrl }),
          })),
          verifyKeyServers: true,
        });

        /*
          Built by `approvalFor`, not here.

          `lib/seal-open.ts` already owns the mapping from an entitlement to the transaction the key
          servers dry-run, and `SealedMedia` has used it since the sealed path existed. Hand-rolling
          a second copy in this component is precisely what the estate's own rule forbids — never
          re-derive what another module builds — and the failure mode is not a compile error: an
          identity with the tag and the vault the wrong way round is the right length and the wrong
          bytes, and the key server refuses it in a way that reads exactly like having no
          entitlement. That mistake has already cost this desk an afternoon once.
        */
        const tx = approvalFor(
          config,
          approver.kind === 'unlock'
            ? (() => {
                /*
                  The approver's key, not the post's. `seal_approve_unlock` asserts the identity
                  equals `unlock_identity(unlock.vault, unlock.content_key)` for the object named,
                  so a machine buyer's `Unlock` (key `<key>#machine`) must be asked for the machine
                  identity — the post's own key would be a MoveAbort that reads as "no access" on
                  a post they paid for. `sealed` is already the matching edition (`visiblePost`).
                */
                const key = approver.contentKey ?? contentKey;
                if (key === undefined) {
                  throw new Error('this post is unlock-gated but carries no content key');
                }
                return { kind: 'unlock' as const, vaultId, contentKey: key, unlockId: approver.objectId };
              })()
            : {
                kind: 'subscription' as const,
                vaultId,
                // `bigint`, never `number`: both are `u64`, and a rounded period builds a valid
                // approval for the wrong month.
                tier: BigInt(approver.tier),
                period: BigInt(approver.period),
                subscriptionId: approver.objectId,
              },
        );
        tx.setSender(signer.address);
        const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

        let key: Uint8Array | undefined;
        let last: unknown;
        for (let attempt = 0; attempt < SETTLING_ATTEMPTS; attempt += 1) {
          try {
            key = new Uint8Array(await seal.decrypt({
              data: Uint8Array.from(atob(sealed.sealWrappedKey), (c) => c.charCodeAt(0)),
              sessionKey, txBytes,
            }));
            break;
          } catch (error) {
            last = error;
            if (cancelled || !looksLikeSettling(error)) throw error;
            const backoff = SETTLING_BACKOFF_MS[attempt];
            if (backoff === undefined) break;
            if (!cancelled) setState({ phase: 'settling' });
            await wait(backoff);
          }
        }
        if (key === undefined) throw last ?? new Error('the key could not be recovered');

        let ciphertext: Uint8Array | undefined;
        for (const base of AGGREGATORS) {
          const r = await fetch(`${base}/v1/blobs/${sealed.blobId}`).catch(() => null);
          if (r?.ok) { ciphertext = new Uint8Array(await r.arrayBuffer()); break; }
        }
        if (ciphertext === undefined) throw new Error('the stored body could not be retrieved');

        const bytes = await openBlob({
          ciphertext, key,
          nonce: Uint8Array.from(atob(sealed.nonce), (c) => c.charCodeAt(0)),
        });

        // Checked here because here is where the plaintext appears. These bytes travelled through
        // storage nobody here operates and came back reassembled from slivers held by many nodes.
        if ((await sha256Hex(bytes)) !== sealed.sha256) {
          throw new Error('the words returned do not match the hash recorded at publish');
        }

        if (!cancelled) setState({ phase: 'ready', text: new TextDecoder().decode(bytes) });
      } catch (error) {
        if (cancelled) return;
        setState({
          phase: 'failed',
          reason: error instanceof Error ? error.message : 'this post could not be opened',
        });
      }
    })();

    return () => { cancelled = true; };
  }, [
    sealed.blobId, sealed.nonce, sealed.sealWrappedKey, sealed.sha256,
    signer, vaultId, contentKey,
    // Depended on field by field rather than by identity: `approver` is rebuilt on every server
    // render, so an object comparison would re-run this effect — and re-prompt the reader for a
    // signature — on every navigation that changed nothing.
    approver?.kind, approver?.objectId,
    approver?.kind === 'subscription' ? approver.tier : undefined,
    approver?.kind === 'subscription' ? approver.period : undefined,
  ]);

  if (state.phase === 'ready') return <PostBody body={state.text} preview={preview} />;

  return (
    <p className="post-body__note" data-body-state={state.phase}>
      {state.phase === 'loading'
        ? 'Opening this post…'
        : state.phase === 'settling'
          ? 'Your purchase is still settling on chain — opening this shortly'
          : state.phase === 'needs-signer'
            ? 'Sign in to read this'
            : state.reason}
    </p>
  );
}
