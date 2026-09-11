'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignInPrompt } from '@/components/SignInPrompt';

function statement(handle: string, following: boolean, address: string, timestampMs: number): string {
  return (
    `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
    `\naction: ${following ? 'follow' : 'unfollow'}\ncreator: ${handle}`
  );
}

export function FollowButton({
  handle,
  initialFollowing,
  initialCount,
}: {
  handle: string;
  initialFollowing: boolean;
  initialCount: number;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const { signer } = useSigner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    const next = !following;
    try {
      const timestampMs = Date.now();
      const signature = await signer.signPersonalMessage(new TextEncoder().encode(statement(handle, next, signer.address, timestampMs)));

      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handle,
          follower: signer.address,
          following: next,
          signature,
          timestampMs,
        }),
      });
      const body = (await response.json()) as {
        following?: boolean;
        followers?: number;
        error?: string;
      };
      if (body.following === undefined) {
        setError(body.error ?? 'could not update');
      } else {
        setFollowing(body.following);
        setCount(body.followers ?? count);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="follow-row">
      {signer === null ? (
        <SignInPrompt action="follow" />
      ) : (
        <button
          className={following ? 'btn ghost' : 'btn'}
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
        >
          {busy ? 'Signing…' : following ? 'Following' : 'Follow'}
        </button>
      )}
      <span className="follow-count">
        {count} follower{count === 1 ? '' : 's'}
      </span>
      {error !== null && <span className="unmeasured">{error}</span>}
    </div>
  );
}
