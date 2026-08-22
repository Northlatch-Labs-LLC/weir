'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * The list, and the one thing a visitor without a wallet can do.
 *
 * # Why this exists on a live product
 *
 * Weir is not pre-launch and this is not a waitlist for it. Everything that matters here needs a Sui
 * address — following, subscribing, tipping, claiming a handle — and somebody who arrives curious
 * but without a wallet is being asked for the one thing they cannot give today. Before this, their
 * only option was to leave. This is the address they can leave instead.
 *
 * # Every outcome renders differently
 *
 * `WaitlistOutcome` has seven inhabitants and all seven are handled below. That is the point of the
 * type: "already on the list", "that handle is spoken for", "we are not configured", "your
 * connection dropped" and "the write failed" ask for five different next actions, and a form that
 * shows one message for all of them is lying about four. In particular a failure never renders as a
 * success — the one bug that would make the whole instrument worthless, because the address would be
 * gone and the person would believe it was safe.
 *
 * # The handle is an intention, not a reservation
 *
 * Saying otherwise would be the dishonest thing on this page. A handle is claimed by a transaction
 * that mints it; until somebody signs one it stays first-come, and no row in our database changes
 * that. The copy says so, and availability is reported as of-this-moment rather than as a hold.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  handleShapeProblem,
  submitWaitlist,
  WAITLIST_ROLES,
  type WaitlistOutcome,
  type WaitlistRole,
  type WaitlistSource,
} from '@/lib/waitlist';

type Phase = { name: 'idle' } | { name: 'sending' } | { name: 'done'; outcome: WaitlistOutcome };

/**
 * What we know about a handle right now.
 *
 * `unknown` and `checking` are stages; `unreadable` is a failure to look. Collapsing them would let
 * "we could not reach the chain" render as "that name is free", which is the one wrong answer that
 * costs somebody a failed transaction later.
 */
type HandleState =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'malformed'; problem: string }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'unreadable' };

const ROLE_LABEL: Record<WaitlistRole, string> = {
  creator: 'I want to publish',
  supporter: 'I want to support someone',
  both: 'Both',
};

export function WaitlistForm({
  source,
  /** The long form — handle and role — as used on `/waitlist`. Elsewhere it is email only. */
  full = false,
}: {
  source: WaitlistSource;
  full?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<WaitlistRole>('supporter');
  const [trap, setTrap] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [handleState, setHandleState] = useState<HandleState>({ kind: 'unknown' });

  // Ids rather than constants: this form can appear more than once on a page, and two inputs sharing
  // an id makes the second label point at the first field — a real defect for anybody using a screen
  // reader or clicking a label.
  const emailId = useId();
  const handleId = useId();
  const trapId = useId();
  const roleName = useId();

  /*
    The live handle check.

    Debounced, because this reaches the chain through `/api/account`, and a read per keystroke would
    spend the node budget of everybody on the deployment answering a question about a half-typed
    word. `stale` guards the ordering: responses can arrive out of order, and without it a slow
    answer for "ali" overwrites a fast one for "alice" and reports the wrong name's availability.
  */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!full) return;

    const wanted = handle.trim().replace(/^@/, '').toLowerCase();
    if (wanted === '') {
      setHandleState({ kind: 'unknown' });
      return;
    }

    const problem = handleShapeProblem(wanted);
    if (problem !== null) {
      // Shape first, locally, so a malformed handle never becomes a chain read.
      setHandleState({ kind: 'malformed', problem });
      return;
    }

    setHandleState({ kind: 'checking' });
    let stale = false;
    if (timer.current !== null) clearTimeout(timer.current);

    timer.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/account?handle=${encodeURIComponent(wanted)}`);
          if (stale) return;
          const body = (await response.json()) as { handle?: { state?: string; error?: string } };
          if (stale) return;

          const status = body.handle;
          // The endpoint keeps failures in their own shape, so a failed read cannot be mistaken for
          // a status. Anything that is not a state we recognise is "we could not look".
          if (status === undefined || typeof status.state !== 'string') {
            setHandleState({ kind: 'unreadable' });
            return;
          }
          if (status.state === 'available') setHandleState({ kind: 'available' });
          else if (status.state === 'taken') setHandleState({ kind: 'taken' });
          else {
            setHandleState({ kind: 'malformed', problem: 'The contract will not accept that name.' });
          }
        } catch {
          if (!stale) setHandleState({ kind: 'unreadable' });
        }
      })();
    }, 400);

    return () => {
      stale = true;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [handle, full]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.name === 'sending') return;
    setPhase({ name: 'sending' });
    const outcome = await submitWaitlist(email, source, role, full ? handle : '', trap);
    setPhase({ name: 'done', outcome });
  }

  const done = phase.name === 'done' ? phase.outcome : null;

  /*
    Success replaces the form rather than sitting under it.

    A form still offering its button after it succeeded invites a second submit, and the second
    submit answers 409 — so the reader is told "you are already on the list" by an interface that put
    the button there.
  */
  if (done?.ok === true) {
    return (
      <div className="waitlist waitlist--done" role="status" aria-live="polite">
        <p className="waitlist__headline">
          {done.already ? 'You are already on the list.' : 'You are on the list.'}
        </p>
        <p className="waitlist__note">
          {done.already
            ? 'This address was added earlier — there is nothing more to do.'
            : 'One email when something ships. No newsletter, no drip campaign.'}
        </p>
      </div>
    );
  }

  return (
    <form className="waitlist" onSubmit={onSubmit} noValidate>
      <div className="waitlist__row">
        <label className="sr-only" htmlFor={emailId}>
          Email address
        </label>
        <input
          id={emailId}
          className="waitlist__input weir-mono"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          placeholder="you@example.com"
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={done !== null && !done.ok && done.kind === 'invalid-email'}
        />

        {/*
          The honeypot. Off-screen rather than `display: none`, because a bot that skips hidden
          fields is exactly the one this is meant to catch — and tab-skipped, `aria-hidden` and
          `autocomplete="off"` so no human and no assistive technology ever reaches it.
        */}
        <label className="waitlist__trap" htmlFor={trapId} aria-hidden>
          Company
          <input
            id={trapId}
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(event) => setTrap(event.target.value)}
          />
        </label>

        {!full && (
          <button className="btn" type="submit" disabled={phase.name === 'sending'}>
            {phase.name === 'sending' ? 'Adding…' : 'Keep me posted'}
          </button>
        )}
      </div>

      {full && (
        <>
          <div className="waitlist__field">
            <label className="waitlist__label" htmlFor={handleId}>
              Handle you would like <span className="waitlist__optional">optional</span>
            </label>
            <input
              id={handleId}
              className="waitlist__input weir-mono"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={handle}
              placeholder="yourname"
              onChange={(event) => setHandle(event.target.value)}
              aria-describedby={`${handleId}-note`}
            />
            {/*
              Every state says what it is. "We could not look" is never rendered as "free": somebody
              told a name is available, who then pays gas to discover it is not, was misled by us.
            */}
            <p
              id={`${handleId}-note`}
              className={
                handleState.kind === 'taken' || handleState.kind === 'malformed'
                  ? 'waitlist__note crit'
                  : handleState.kind === 'unreadable'
                    ? 'waitlist__note warn'
                    : 'waitlist__note'
              }
              aria-live="polite"
            >
              {handleState.kind === 'unknown' &&
                'Noting a preference reserves nothing — a handle is claimed by the transaction that mints it.'}
              {handleState.kind === 'checking' && 'Checking the registry…'}
              {handleState.kind === 'malformed' && handleState.problem}
              {handleState.kind === 'available' &&
                'Free as of this moment. It stays first-come until somebody mints it.'}
              {handleState.kind === 'taken' && 'Taken — it resolves to a page already on chain.'}
              {handleState.kind === 'unreadable' &&
                'We could not reach the registry, so this is unchecked rather than free.'}
            </p>
          </div>

          <fieldset className="waitlist__field waitlist__roles">
            <legend className="waitlist__label">Which are you?</legend>
            {WAITLIST_ROLES.map((option) => (
              <label key={option} className="waitlist__role">
                <input
                  type="radio"
                  name={roleName}
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                />
                <span>{ROLE_LABEL[option]}</span>
              </label>
            ))}
          </fieldset>

          <button className="btn" type="submit" disabled={phase.name === 'sending'}>
            {phase.name === 'sending' ? 'Adding…' : 'Join the list'}
          </button>
        </>
      )}

      <p className="waitlist__legal">
        One email when something ships. No newsletter, and nothing shared with anyone.
      </p>

      {done !== null && !done.ok && (
        <p
          className={done.kind === 'unconfigured' ? 'waitlist__msg warn' : 'waitlist__msg crit'}
          role="alert"
        >
          {done.kind === 'invalid-email' && done.detail}
          {done.kind === 'handle-on-list' &&
            'Someone on the list asked for that handle first. Choose another — nothing was stored.'}
          {done.kind === 'unconfigured' &&
            'The list is not switched on for this deployment yet, so your address was stored nowhere and you are not on it.'}
          {done.kind === 'transport' &&
            'We could not reach the server, so nothing was stored. Check your connection and try again.'}
          {done.kind === 'server' &&
            'Something failed on our side and your address was not stored. That one is us, not you — please try again.'}
        </p>
      )}
    </form>
  );
}
