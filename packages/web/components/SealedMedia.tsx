'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * A post's picture, opened in the reader's own tab when it arrives sealed.
 *
 * # Why an `<img src>` could not stay
 *
 * A sealed asset leaves the media route as `application/octet-stream` with the key wrapped in a
 * header, because this server holds no key and cannot open it. A browser handed those bytes by a
 * plain `<img>` paints its broken-image glyph — so the card of a creator's *paid* post, the one
 * thing a reader actually bought, was the only one guaranteed to look broken. Everything needed to
 * open it existed and was tested; nothing called it.
 *
 * So this component is the caller. It fetches the asset itself, asks {@link readMediaResponse} what
 * came back, and takes one of two paths that end in the same `<img>`.
 *
 * # Public media still goes the short way
 *
 * A `plain` response is turned straight into an object URL. That is a deliberate second path rather
 * than a special case of the first: free and platform-custody media already worked, this work must
 * not change what those readers see, and routing them through a key server would make a public
 * picture depend on a threshold committee being reachable.
 *
 * # What the tab is trusted with, and what it is not
 *
 * The reader's browser receives the ciphertext, the wrapped key, and the id of the entitlement
 * object the route accepted. All three are public: the first two sit on Walrus and in a header the
 * server already sends, and the third is an object id anybody can read from chain. None of them
 * opens anything. The key servers re-execute `entitlement::seal_approve_unlock` with the *reader* as
 * sender against a `SessionKey` that reader signed, so a tab that lies about which object it holds
 * gets an abort, not a key.
 *
 * The API keys for permissioned key servers are the exception, and they never arrive here.
 * `/api/seal` publishes object ids, weights and aggregator URLs only. A deployment whose committee
 * requires an API key cannot decrypt in the browser without proxying, and this component says so
 * out loud rather than shipping a credential to every reader to make the happy path work.
 *
 * # Where the settings come from
 *
 * Fetched, not passed. This renders inside `PostCard` → `Creator`/`Home`, which are client
 * components, so no ancestor can read `siteConfig()` on its behalf. The browser asks `/api/seal`,
 * which is the same answer `Footer` and sign-in already give to the same question.
 *
 * Asked **once per tab**, not once per picture: a feed of twelve posts would otherwise open twelve
 * identical requests before the first one answered. The in-flight promise is shared at module
 * scope, so the twelfth card awaits the first card's request.
 */

import { useEffect, useRef, useState } from 'react';
import { SealClient, SessionKey } from '@mysten/seal';
import { createClient, type ProjectXSocialConfig } from '@projectx-social/sdk';

import { useSigner } from '@/components/SignerProvider';
import { isSettling, openSealedMedia, readMediaResponse } from '@/lib/seal-open';

/**
 * A key server, as a browser is allowed to know it.
 *
 * Structurally the public subset of the SDK's `SealKeyServer`, and separate from it on purpose: the
 * full type carries `apiKey`, and a component typed against it would accept one without complaint.
 */
export interface PublicKeyServer {
  objectId: string;
  weight: number;
  /** Present for a committee-mode server, absent for an independent one. The SDK reads the difference. */
  aggregatorUrl?: string;
}

/** What `/api/seal` answers with. `config` is null on a deployment not pointed at a chain. */
interface SealSettings {
  config: ProjectXSocialConfig | null;
  keyServers: PublicKeyServer[];
}

/**
 * The one request per tab, shared.
 *
 * Deliberately not `useState` in a hook: every card would then own its own copy and its own
 * request. A module-level promise is the narrowest thing that makes twelve cards cost one call, and
 * it is discarded on failure so a tab that started offline can succeed later rather than caching
 * the outage for its lifetime.
 */
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

/** How long a signed session lasts before the reader is asked again. Ten minutes of reading. */
const SESSION_TTL_MIN = 10;

/**
 * The settling window, and why a refusal is not always a refusal.
 *
 * A key server checks the policy by simulating `seal_approve_unlock` against a fullnode. A
 * freshly-created `Unlock` is not indexed there for a few seconds, and the server maps that
 * `NotFound` to a refusal. So the sequence a buyer actually performs — pay, then open the post —
 * has a real window in which the reader who just paid is told they have no access.
 *
 * SEAL.md called this out on 21 August, before any of this was built: it "must not surface as
 * 'you do not have access', which is both wrong and alarming on a screen the buyer reached by
 * paying." This component shipped without the retry and the Master met it within a minute of
 * buying, exactly as predicted.
 *
 * Bounded, not indefinite: four attempts over roughly fifteen seconds. A genuine refusal — the
 * reader really has no entitlement — costs those seconds and then says so plainly. Retrying
 * forever would turn a correct "no" into a spinner that never resolves.
 */
const SETTLING_ATTEMPTS = 4;
const SETTLING_BACKOFF_MS = [1500, 3500, 6000];

/*
  The predicate lives in `lib/seal-open.ts` now, and matches on `instanceof` rather than on text.

  What was here matched `` `${error.name} ${error.message}` `` against a regex. Measured against
  `@mysten/seal` 1.4.6: **every error in that library reports `error.name === "Error"`** — the
  classes are anonymous expressions and never assign `name` — so the name half matched nothing and
  each class had to be recognised by its prose. `NoAccessError` survived on "does not have access".
  `InvalidParameterError` did not: its message says the object "has not yet **seen**" where the
  regex looked for "not yet **exist**".

  That is the freshly-minted `Unlock` case — the one this retry exists for — so the retry never
  fired on it, and a reader who had just paid was told they had no access. Exactly the failure
  `SEAL.md` predicted on 21 August.
*/

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

  /*
    The object URL is held in a ref as well as in state so cleanup can revoke it.

    Reading it out of `state` inside the cleanup would close over the value from the render that
    scheduled the effect, which for a component that re-runs on sign-in is reliably the *previous*
    URL — revoking one blob while the newest one leaks. The ref always holds the current one.
  */
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const publish = (bytes: Uint8Array, contentType: string) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
      if (cancelled) {
        // Arrived after unmount. Revoked immediately rather than assigned: nothing will render it,
        // and an object URL nobody holds is a leak that lives until the tab closes.
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
          /*
            The route's own vocabulary, preserved. 403 is a paywall and 424 is storage — telling a
            reader who paid that their media "could not be retrieved" is true, and telling them they
            are "not entitled" when a Walrus aggregator is down is not.
          */
          throw new Error(
            response.status === 403
              ? 'this is not unlocked for you'
              : response.status === 503
                ? 'still checking what you own — try again in a moment'
                : 'this media could not be retrieved',
          );
        }

        const media = await readMediaResponse(response);
        if (media.kind === 'plain') {
          publish(media.bytes, media.contentType);
          return;
        }

        if (signer === null) {
          // Sealed, and no signer to prove anything with. Not an error: the reader is simply not
          // signed in yet, and the key servers require a signature this tab cannot produce alone.
          if (!cancelled) setState({ phase: 'needs-signer' });
          return;
        }
        if (media.entitlement === undefined) {
          throw new Error('the server did not say which entitlement opens this');
        }

        /*
          Asked for only now, and only by a card that actually holds sealed bytes.

          A feed is mostly public pictures, and those took the `plain` path above and returned. Not
          one of them opens this request.
        */
        const { config, keyServers } = await sealSettingsOnce();
        if (cancelled) return;
        if (config === null || keyServers.length === 0) {
          throw new Error('this deployment has no key servers configured');
        }

        const suiClient = createClient(config);

        /*
          The session the key servers will check.

          Signed by the reader with their own key — wallet or zkLogin, both satisfy `ActiveSigner` —
          and never by this server, which is the entire content of the promise that our own operators
          cannot open a creator's paid media. `SessionKey.create` reads the package object, which is
          why the browser holds a chain client at all.
        */
        const sessionKey = await SessionKey.create({
          address: signer.address,
          packageId: config.packageId,
          ttlMin: SESSION_TTL_MIN,
          suiClient,
        });
        const signature = await signer.signPersonalMessage(sessionKey.getPersonalMessage());
        if (cancelled) return;
        await sessionKey.setPersonalMessageSignature(signature);

        const seal = new SealClient({
          suiClient,
          serverConfigs: keyServers.map((server) => ({
            objectId: server.objectId,
            weight: server.weight,
            // Spread rather than assigned, matching `lib/seal.ts`: the SDK tells a committee-mode
            // server from an independent one by whether this key is *present*, and an explicit
            // `undefined` counts as present.
            ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
          })),
          // Set explicitly for the same reason the server sets it: the installed SDK defaults this
          // to `false` while its documentation says otherwise.
          verifyKeyServers: true,
        });

        /*
          The seam `lib/seal-open.ts` describes, filled in — and wrapped in the settling retry.

          This is the only place in the browser that reaches `@mysten/seal`'s network path, so it
          is the only place that can tell the difference between "this reader has nothing" and
          "the chain has not caught up with what they just bought". Both arrive as the same
          `NoAccessError`, which is why the distinction has to be made by patience rather than by
          reading the error.
        */
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

  /*
    Revoking on unmount, and only on unmount.

    Kept apart from the fetch effect deliberately: that one re-runs whenever the signer changes, and
    revoking there would pull the URL out from under an `<img>` that is still displaying it.
  */
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

  /*
    Everything else is the same ruled veil a locked post already uses, with the reason underneath.

    Not a broken-image glyph and not an empty box: those both read as *our* fault. A reader who is
    not signed in, a committee that is unreachable and a blob that failed its hash are three
    different sentences, and the reader is told which one happened.
  */
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
              ? 'Your purchase is still settling on chain — opening this shortly'
              : state.reason}
        </span>
      )}
    </span>
  );
}
