'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useRef, useState } from 'react';
import { SealClient } from '@mysten/seal';
import { sessionKeyFor } from '@/lib/seal-session';
import { createClient, type ProjectXSocialConfig } from '@projectx-social/sdk';

import { useSigner } from '@/components/SignerProvider';
import { isSettling, openSealedMedia, readMediaResponse } from '@/lib/seal-open';

export interface PublicKeyServer {
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
}

interface SealSettings {
  config: ProjectXSocialConfig | null;
  keyServers: PublicKeyServer[];
}

let settingsRequest: Promise<SealSettings> | null = null;

function sealSettingsOnce(): Promise<SealSettings> {
  settingsRequest ??= fetch('/api/seal', { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error('could not read this deployment\u2019s seal settings');
      return response.json() as Promise<SealSettings>;
    })
    .catch((error: unknown) => {
      settingsRequest = null;
      throw error;
    });
  return settingsRequest;
}

const SESSION_TTL_MIN = 10;

const SETTLING_ATTEMPTS = 4;
const SETTLING_BACKOFF_MS = [1500, 3500, 6000];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string }
  /** Sealed, and nobody is signed in to open it. A prompt, not a failure. */
  | { phase: 'needs-signer' }
  /** The purchase is real and the chain has not caught up. Not a refusal — see the retry above. */
  | { phase: 'settling' }
  | { phase: 'failed'; reason: string };

export function SealedMedia({
  src,
  alt = '',
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const { signer } = useSigner();
  const [state, setState] = useState<State>({ phase: 'loading' });

  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const publish = (bytes: Uint8Array, contentType: string) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      if (objectUrl.current !== null) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = url;
      setState({ phase: 'ready', url });
    };

    void (async () => {
      try {
        const response = await fetch(src, { credentials: 'same-origin' });
        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? 'this is not unlocked for you'
              : response.status === 503
                ? 'Still checking what you own. Try again in a moment.'
                : 'this media could not be retrieved',
          );
        }

        const media = await readMediaResponse(response);
        if (media.kind === 'plain') {
          publish(media.bytes, media.contentType);
          return;
        }

        if (signer === null) {
          if (!cancelled) setState({ phase: 'needs-signer' });
          return;
        }
        if (media.entitlement === undefined) {
          throw new Error('the server did not say which entitlement opens this');
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
          serverConfigs: keyServers.map((server) => ({
            objectId: server.objectId,
            weight: server.weight,
            ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
          })),
          verifyKeyServers: true,
        });

        const recoverKey = async ({ wrappedKey, approvalBytes }: {
          wrappedKey: Uint8Array; approvalBytes: Uint8Array;
        }) => {
          let last: unknown;
          for (let attempt = 0; attempt < SETTLING_ATTEMPTS; attempt += 1) {
            try {
              return new Uint8Array(
                await seal.decrypt({ data: wrappedKey, sessionKey, txBytes: approvalBytes }),
              );
            } catch (error) {
              last = error;
              if (cancelled || !isSettling(error)) throw error;
              const backoff = SETTLING_BACKOFF_MS[attempt];
              if (backoff === undefined) break;
              if (!cancelled) setState({ phase: 'settling' });
              await wait(backoff);
            }
          }
          throw last;
        };

        const opened = await openSealedMedia({
          config,
          media,
          entitlement: media.entitlement,
          client: suiClient,
          recoverKey,
        });

        publish(opened.bytes, opened.contentType);
      } catch (error) {
        if (cancelled) return;
        setState({
          phase: 'failed',
          reason: error instanceof Error ? error.message : 'this media could not be opened',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `signer` is a dependency because signing in is exactly the event that turns a `needs-signer`
    // tile into a picture, and a reader who signs in should not have to reload to see what they own.
  }, [src, signer]);

  useEffect(
    () => () => {
      if (objectUrl.current !== null) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    },
    [],
  );

  if (state.phase === 'ready') {
    return <img className={className} alt={alt} src={state.url} />;
  }

  return (
    <span className={className} role="img" aria-label={alt === '' ? 'media' : alt} data-media-state={state.phase}>
      <span className="tile__veil" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {state.phase !== 'loading' && (
        <span className="post-media__note">
          {state.phase === 'needs-signer'
            ? 'Sign in to view this'
            : state.phase === 'settling'
              ? 'Your purchase is still settling on chain. It opens in a moment.'
              : state.reason}
        </span>
      )}
    </span>
  );
}
