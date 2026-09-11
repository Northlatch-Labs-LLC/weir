'use client';
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { useEffect, useState } from 'react';
import { SealClient } from '@mysten/seal';
import { createClient, type ProjectXSocialConfig } from '@projectx-social/sdk';

import { useSigner } from '@/components/SignerProvider';
import { PostBody } from '@/components/PostBody';
import { readVaultCoinType } from '@projectx-social/sdk';
import { approvalFor, isSettling, openBlob, sha256Hex } from '@/lib/seal-open';
import { sessionKeyFor } from '@/lib/seal-session';

export interface SealedBodyRef {
  blobId: string;
  nonce: string;
  sealWrappedKey: string;
  sha256: string;
}

export type Approver =
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; text: string }
  | { phase: 'needs-signer' }
  | { phase: 'settling' }
  | { phase: 'failed'; reason: string };

export function SealedBody({
  sealed, preview, vaultId, coinType, contentKey, approver,
}: {
  sealed: SealedBodyRef;
  preview: string;
  vaultId: string;
  coinType?: string | null;
  contentKey?: string;
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
        const sessionKey = await sessionKeyFor({ signer, packageId: config.packageId, ttlMin: SESSION_TTL_MIN, suiClient });
        if (cancelled) return;

        const seal = new SealClient({
          suiClient,
          serverConfigs: keyServers.map((s) => ({
            objectId: s.objectId, weight: s.weight,
            ...(s.aggregatorUrl === undefined ? {} : { aggregatorUrl: s.aggregatorUrl }),
          })),
          verifyKeyServers: true,
        });

        const resolvedCoinType =
          approver.kind === 'subscription'
            ? (coinType ?? (await (async () => {
                const read = await readVaultCoinType(suiClient, vaultId);
                if (!read.ok) throw new Error(`could not read the vault's coin type: ${read.failure.detail}`);
                return read.value;
              })()))
            : null;
        const tx = approvalFor(
          config,
          approver.kind === 'unlock'
            ? (() => {
                const key = approver.contentKey ?? contentKey;
                if (key === undefined) {
                  throw new Error('this post is unlock-gated but carries no content key');
                }
                return { kind: 'unlock' as const, vaultId, contentKey: key, unlockId: approver.objectId };
              })()
            : {
                kind: 'subscription' as const,
                vaultId,
                coinType: resolvedCoinType!,
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
            if (cancelled || !isSettling(error)) throw error;
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
          ? 'Your purchase is still settling on chain. It opens in a moment.'
          : state.phase === 'needs-signer'
            ? 'Sign in to read this'
            : state.reason}
    </p>
  );
}
