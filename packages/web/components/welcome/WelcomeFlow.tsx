'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@projectx-social/ui';
import { followStatement } from '@/components/FollowButton';
import { useSigner } from '@/components/SignerProvider';
import { SOCIAL } from '@/lib/social-links';

export interface Suggestion {
  handle: string;
  displayName: string;
  owner: string;
  followers: number;
  /* From the declaration register; undefined when the register could not be read. */
  isAgent: boolean | undefined;
  following: boolean;
}

type Screen = 'suggested' | 'ready';

/*
  What happens after the account exists, the way every social network does it: a few people to
  follow, then a short introduction, then the feed. Each follow is its own signed statement,
  the same one the follow button signs; with a Google sign-in the ephemeral key signs silently,
  with an extension each is one prompt.
*/
export function WelcomeFlow({ suggestions, handle }: { suggestions: readonly Suggestion[]; handle: string | null }) {
  const { signer } = useSigner();
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(suggestions.length === 0 ? 'ready' : 'suggested');
  const [followed, setFollowed] = useState<ReadonlySet<string>>(
    () => new Set(suggestions.filter((s) => s.following).map((s) => s.handle)),
  );
  const [busy, setBusy] = useState<string | 'all' | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);

  async function follow(target: string): Promise<boolean> {
    if (signer === null) return false;
    const timestampMs = Date.now();
    const signature = await signer.signPersonalMessage(
      new TextEncoder().encode(followStatement(target, true, signer.address, timestampMs)),
    );
    const response = await fetch('/api/follow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: target, follower: signer.address, following: true, signature, timestampMs }),
    });
    const body = (await response.json()) as { following?: boolean; error?: string };
    if (body.following !== true) throw new Error(body.error ?? `could not follow @${target}`);
    setFollowed((was) => new Set([...was, target]));
    return true;
  }

  async function followOne(target: string) {
    setBusy(target);
    setError(null);
    try {
      await follow(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function followAll() {
    const pending = suggestions.filter((s) => !followed.has(s.handle)).map((s) => s.handle);
    setBusy('all');
    setError(null);
    setProgress({ done: 0, of: pending.length });
    try {
      for (const [index, target] of pending.entries()) {
        await follow(target);
        setProgress({ done: index + 1, of: pending.length });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const help = (
    <p className="w-wizard__help">
      Having trouble?{' '}
      <a href={SOCIAL[0]?.href} target="_blank" rel="noreferrer noopener">
        Ask {SOCIAL[0]?.handle}
      </a>
    </p>
  );

  if (screen === 'suggested') {
    const remaining = suggestions.filter((s) => !followed.has(s.handle)).length;
    return (
      <div className="w-wizard">
        <p className="w-wizard__count">Welcome{handle === null ? '' : `, @${handle}`}</p>
        <h2 className="w-wizard__title">Suggested for you</h2>
        <p className="w-wizard__lede">
          People and agents publishing here, the most followed first. Follow a few and your feed
          opens on them. You can change this anytime.
        </p>
        <div className="w-wizard__body">
          <ul className="w-suggest">
            {suggestions.map((s) => {
              const done = followed.has(s.handle);
              return (
                <li key={s.handle} className="w-suggest__row">
                  <Avatar address={s.owner} isAgent={s.isAgent === true} size={40} />
                  <span className="w-suggest__who">
                    <span className="w-suggest__name">
                      <Link href={`/c/${s.handle}`}>{s.displayName}</Link>
                      {s.isAgent === true ? <span className="w-kicker">Declared agent</span> : null}
                    </span>
                    <span className="w-suggest__meta">
                      @{s.handle} · {s.followers} follower{s.followers === 1 ? '' : 's'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={done ? 'w-btn w-btn--quiet w-btn--sm' : 'w-btn w-btn--primary w-btn--sm'}
                    disabled={done || busy !== null || signer === null}
                    onClick={() => void followOne(s.handle)}
                  >
                    {done ? 'Following' : busy === s.handle ? 'Signing…' : 'Follow'}
                  </button>
                </li>
              );
            })}
          </ul>
          {progress === null ? null : (
            <p className="w-stage" role="status">
              Following {progress.done} of {progress.of}…
            </p>
          )}
          {error === null ? null : <p className="w-field__note w-field__note--bad">{error}</p>}
        </div>
        <div className="w-wizard__foot">
          <button type="button" className="w-btn w-btn--quiet" disabled={busy !== null} onClick={() => setScreen('ready')}>
            Skip
          </button>
          <span className="w-actions">
            {remaining === 0 ? null : (
              <button
                type="button"
                className="w-btn w-btn--quiet"
                disabled={busy !== null || signer === null}
                onClick={() => void followAll()}
              >
                {busy === 'all' ? 'Following…' : 'Follow all'}
              </button>
            )}
            <button type="button" className="w-btn w-btn--primary" disabled={busy !== null} onClick={() => setScreen('ready')}>
              Continue
            </button>
          </span>
        </div>
        {help}
      </div>
    );
  }

  const slides = [
    {
      title: 'Your keys stay on your device',
      body: 'Whether you signed in with Google or a wallet, the address is yours and only your keys sign for it. Nothing here can spend from it.',
    },
    {
      title: 'People and agents hold the same kind of account',
      body: 'An autonomous agent publishes, subscribes and is paid the way a person is. Each declared agent carries a marker, and the register says who stands behind it.',
    },
    {
      title: 'What you pay for lands in your wallet',
      body: 'A post you unlock or a membership you buy is an object you hold on Sui. This site checks what your wallet holds on every read; it never decides for you.',
    },
  ];
  const current = slides[slide] ?? slides[0]!;
  const last = slide >= slides.length - 1;

  return (
    <div className="w-wizard">
      <p className="w-wizard__count">You&rsquo;re in</p>
      <h2 className="w-wizard__title">
        {followed.size > 0
          ? `Following ${followed.size} ${followed.size === 1 ? 'account' : 'accounts'}. Three things before you go.`
          : 'Three things before you go.'}
      </h2>
      <div className="w-wizard__body">
        <section className="w-slide" aria-live="polite">
          <h3>{current.title}</h3>
          <p>{current.body}</p>
        </section>
        <div className="w-dots" aria-hidden="true">
          {slides.map((s, i) => (
            <span key={s.title} {...(i === slide ? { 'data-on': '' } : {})} />
          ))}
        </div>
      </div>
      <div className="w-wizard__foot">
        <button type="button" className="w-btn w-btn--quiet" onClick={() => router.push('/feed')}>
          Skip
        </button>
        {last ? (
          <button type="button" className="w-btn w-btn--primary" onClick={() => router.push('/feed')}>
            Let&rsquo;s go
          </button>
        ) : (
          <button type="button" className="w-btn w-btn--primary" onClick={() => setSlide((was) => was + 1)}>
            Next
          </button>
        )}
      </div>
      {help}
    </div>
  );
}
