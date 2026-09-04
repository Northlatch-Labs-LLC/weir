'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * The **`gated` notice** — "the app itself is still behind the door… I have a code" — renders only
 * while `site_mode.waitlist_mode` is set, and the button does what it says: it opens a field that
 * redeems an access code minted at `/admin`, and a good code sets the pass `proxy.ts` honours.
 * See `lib/access-codes.ts`.
 */

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Fragment } from 'react';
import { Icon } from '@/components/design/icons';
import { useWeirLine } from '@/components/design/use-weir-line';
import {
  handleShapeProblem,
  submitWaitlist,
  type WaitlistOutcome,
  type WaitlistRole,
} from '@/lib/waitlist';
import { useHandleAvailability } from '@/components/design/use-handle-availability';
/*
  The bounds come from the SDK, never from literals here. `packages/sdk/src/accounts.ts` mirrors
  `account.move` and a drift test asserts the two agree, so a bound that moves in the contract moves
  in this sentence. A number typed into this file would not.
*/
import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';
import { Countdown } from '@/components/design/Countdown';
import { ExploreFunnel, type FunnelSides } from '@/components/design/ExploreFunnel';

const CREST = 'var(--crest,#8be3c6)';
const SAND = 'var(--sand,#d9c9a3)';
const ALERT = 'var(--alert,#f2a29b)';
const DIM = 'var(--dim,#a3bcb8)';
const LINE = 'var(--line,#1c3d47)';

const ROLES: readonly { value: WaitlistRole; label: string; icon: string }[] = [
  { value: 'creator', label: 'A creator', icon: 'doc' },
  { value: 'supporter', label: 'A supporter', icon: 'users' },
  { value: 'both', label: 'Both', icon: 'layers' },
];

/**
 * What being early actually gets somebody.
 */
/** What joining gets you. The first item depends on whether the door is open today. */
function perksFor(gated: boolean) {
  return [
    gated
      ? { icon: 'bell', title: 'First to know', body: 'One message the moment the doors open.' }
      : { icon: 'eye', title: 'Read everything now', body: 'The feed, every creator page and the contracts are open today.' },
    { icon: 'key', title: 'Your handle, noted', body: 'Tell us the name you want. It is yours once you mint it.' },
    { icon: 'shield', title: 'No wallet needed', body: 'Just an email. You will need a wallet only when you create your account.' },
  ] as const;
}

export function DesignWaitlist({
  signedIn = false,
  myHandle = null,
  gated = false,
  total = null,
  launchTarget = null,
  funnel = null,
}: {
  signedIn?: boolean;
  /**
   * The two-sided funnel — creators and declared agents — read on the server. `null` renders no
   * funnel at all, which is what a test or a caller without the data gets; a failed read is not
   * `null`, it is a side that says it failed.
   */
  funnel?: FunnelSides | null;
  myHandle?: string | null;
  /**
   * How many addresses are on the list, counted on the server for this request.
   *
   * `null` means the count could not be taken — an unconfigured deployment, or a database that did
   * not answer — and renders as no counter at all rather than as zero. Zero is a real answer that a
   * genuinely empty list should be able to give, so the two cannot share a representation.
   */
  total?: number | null;
  /**
   * Typed as the pair rather than as two optional fields, so "a date with no label" cannot be
   * expressed here any more than it can in the schema. See `components/design/Countdown.tsx`.
   */
  launchTarget?: { atMs: number; label: string } | null;
  /**
   * The site is closed and this page is where everybody lands.
   */
  gated?: boolean;
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useWeirLine(canvasRef);

  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<WaitlistRole>('supporter');
  const [trap, setTrap] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<WaitlistOutcome | null>(null);
  const trapId = useId();

  /*
    The code out of the link they followed, if they followed one.
  */
  const [ref, setRef] = useState('');
  /*
    Where the gate sent them from, so a redeemed code returns them there. A local path only —
    `proxy.ts` already refuses to write anything else into `?from=`, and this refuses it again.
  */
  const [from, setFrom] = useState('/');
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const code = search.get('ref');
    if (code !== null && code.trim() !== '') setRef(code.trim());
    const back = search.get('from');
    if (back !== null && back.startsWith('/') && !back.startsWith('//')) setFrom(back);
  }, []);

  /* "I have a code": the field, the attempt, and the server's own reason when it refuses. */
  const [showCode, setShowCode] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function redeem() {
    if (redeeming) return;
    setRedeeming(true);
    setCodeError(null);
    try {
      const response = await fetch('/api/access-codes/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: accessCode }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || body.ok !== true) {
        setCodeError(body.error ?? `the code was refused (${response.status})`);
        return;
      }
      // The pass is a cookie the server just set; a full navigation is what makes the gate read it.
      window.location.href = from;
    } catch (cause) {
      setCodeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRedeeming(false);
    }
  }

  const [copied, setCopied] = useState(false);

  const availability = useHandleAvailability(handle);

  async function onWlSubmit() {
    if (sending) return;
    setSending(true);
    setOutcome(await submitWaitlist(email, 'waitlist', role, handle, trap, ref));
    setSending(false);
  }

  const emailTouched = email.trim() !== '';
  const emailLooksWrong = emailTouched && !email.includes('@');
  const wlEmailBorder = emailLooksWrong ? ALERT : LINE;

  const shapeProblem = handleShapeProblem(handle);

  /*
    Capitals, reported rather than absorbed.

    `account.move` rejects any byte outside `[a-z0-9_]`, and the SDK spells out the reason it does
    not fold instead: "a registry that lower-cases what you typed hands you a different handle from
    the one you asked for and reports success." The availability check lower-cases before it looks,
    so "Alice" is read as "alice" and comes back available — a green note for a handle the contract
    would refuse as typed. Saying so here is the only warning the person gets.
  */
  const hasUppercase = /[A-Z]/.test(handle.trim().replace(/^@/, ''));

  /*
    `malformed` had no branch, and that was the whole defect.

    The chain below ended in a bare `Optional.` in dim grey, so a handle the registry had just
    called invalid produced the same note as an empty field: the person was told nothing, and
    submitted. It is reachable even when `handleShapeProblem` is satisfied, because the registry is
    the authority and this client is not. Anything that slips through locally lands here.
  */
  const wlHandleNote =
    handle.trim() === ''
      ? 'Optional. We will note it — it is yours once you mint it on chain.'
      : shapeProblem !== null
        ? shapeProblem
        : hasUppercase
          ? 'Lowercase only — the contract rejects capitals rather than converting them.'
          : availability === 'malformed'
            ? `Not a valid handle. Use ${MIN_HANDLE_LEN}–${MAX_HANDLE_LEN} characters: lowercase letters, numbers and underscores.`
            : availability === 'checking'
              ? 'Checking the registry…'
              : availability === 'taken'
                ? 'Taken — this handle already has a page.'
                : availability === 'available'
                  ? 'Available right now.'
                  : availability === 'unreadable'
                    ? 'Could not check availability just now — you can still note it.'
                    : 'Optional.';
  const wlHandleColor =
    shapeProblem !== null || hasUppercase || availability === 'malformed' || availability === 'taken'
      ? ALERT
      : availability === 'unreadable'
        ? SAND
        : availability === 'available'
          ? CREST
          : DIM;

  const wlRoles = ROLES.map((option) => ({
    label: option.label,
    icon: <Icon name={option.icon} size={14} />,
    checked: role === option.value,
    onClick: () => setRole(option.value),
    color: role === option.value ? CREST : DIM,
    bg: role === option.value ? 'rgba(var(--crest-rgb,139,227,198),0.08)' : 'transparent',
    border: role === option.value ? CREST : LINE,
  }));

  /*
    The result panel. Every branch of `WaitlistOutcome` gets its own title, body and accent, which is
    the whole point of the type: a form that shows one cheerful message whatever happened is lying
    four different ways. A failure never renders in crest.
  */
  const result = ((): null | { icon: string; title: string; body: string; detail: string; accent: string } => {
    if (outcome === null) return null;
    if (outcome.ok) {
      return outcome.already
        ? { icon: 'check', title: 'Already on the list', body: 'This email joined earlier.', detail: 'Nothing more to do.', accent: CREST }
        : { icon: 'check', title: 'You are on the list', body: gated ? 'One message when the doors open.' : 'One message when something new ships.', detail: 'No newsletter.', accent: CREST };
    }
    switch (outcome.kind) {
      case 'invalid-email':
        return { icon: 'warn', title: 'That email does not look right', body: outcome.detail, detail: 'Nothing was sent. Please check it and try again.', accent: SAND };
      case 'handle-on-list':
        return { icon: 'warn', title: 'That handle is taken', body: 'Someone on the list asked for it first.', detail: 'Choose another — your email has not been added yet.', accent: SAND };
      case 'unconfigured':
        return { icon: 'warn', title: 'The list is unavailable right now', body: 'We could not add you.', detail: 'Please try again later.', accent: SAND };
      case 'transport':
        return { icon: 'warn', title: 'Could not connect', body: 'Check your connection and try again.', detail: 'Nothing was sent.', accent: ALERT };
      case 'server':
        return { icon: 'warn', title: 'Something went wrong on our side', body: 'Your email was not added.', detail: 'Please try again.', accent: ALERT };
    }
  })();

  /*
    Where they stand, and the link they can share.

    Only ever present on a success, because it is only ever sent with one. The link is built from
    `window.location.origin` so it is correct on any deployment without a configured base URL — and
    it is built in render rather than an effect only because it is read at click time, never painted
    before hydration.
  */
  const standing = outcome !== null && outcome.ok ? (outcome.standing ?? null) : null;
  const refLink =
    standing === null
      ? ''
      : `${typeof window === 'undefined' ? '' : window.location.origin}/waitlist?ref=${standing.refCode}`;

  async function onCopyRef() {
    if (refLink === '') return;
    try {
      await navigator.clipboard.writeText(refLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /*
        Clipboard access is refused in some browsers and in every insecure context. The input beside
        the button holds the same text and is selectable, so the link is still obtainable — silently
        leaving the button unchanged is honest here: nothing was copied, and it does not claim it was.
      */
    }
  }

  const wlHasResult = result !== null;
  const wlResultIcon = result === null ? null : <Icon name={result.icon} size={15} color={result.accent} />;
  const wlResultTitle = result?.title ?? '';
  const wlResultBody = result?.body ?? '';
  const wlResultDetail = result?.detail ?? '';
  const wlResultAccent = result?.accent ?? CREST;
  const wlResultBorder = result === null ? LINE : result.accent;

  const wlEmail = email;
  const wlHandle = handle;
  const wlSubmitLabel = sending ? 'Adding…' : 'Join the waiting list';
  const onWlEmail = (e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value);
  const onWlHandle = (e: ChangeEvent<HTMLInputElement>) => setHandle(e.target.value);
  const wlPerks = perksFor(gated).map((p) => ({ ...p, icon: <Icon name={p.icon} size={15} color={CREST} /> }));

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '4rem 1.5rem 4rem' }}>
            {/*
              Left to right, not center-stacked (the brand ruling). The badge, heading, lede and
              counter form one left-aligned column instead of a centred block with no media query;
              the form and the rest of the page continue to sit below it, as they already did.
              Every word of copy is unchanged — only `textAlign` and the `auto` margins that centred
              the block move.
            */}
            <div style={{ textAlign: 'left', maxWidth: '52rem' }}>
              <p style={{ margin: '0 0 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.625rem', padding: '0.35rem 0.85rem 0.35rem 0.65rem', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.3)', borderRadius: '99px', background: 'rgba(var(--pd,11,37,48),0.7)', boxShadow: '0 0 22px -10px rgba(var(--crest-rgb,139,227,198),0.7)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>
                <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: 'var(--crest,#8be3c6)', boxShadow: '0 0 10px rgba(var(--crest-rgb,139,227,198),0.9)', animation: 'pulseRing 2.6s ease-out infinite' }}></span>
                {gated ? 'Closed alpha — by invitation' : 'Open'}
              </p>
              <h1 style={{ margin: '0', textAlign: 'left', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.05', letterSpacing: '-0.038em', fontSize: 'clamp(2.25rem,1.2rem + 3.4vw,3.75rem)', maxWidth: '26ch', textWrap: 'balance' }}>{gated ? 'Weir is in ' : 'Weir is '}<span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 30px rgba(var(--crest-rgb,139,227,198),0.4))' }}>{gated ? 'closed alpha.' : 'open.'}</span></h1>
              <p style={{ margin: '1.125rem 0 0', maxWidth: '58ch', textAlign: 'left', fontSize: '1.0625rem', lineHeight: '1.65', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>{gated ? 'Creators are onboarding now, by invitation. Leave your email and we will send one message when the doors open — and note the handle you would like.' : 'Creator pages are open. Claim a handle now, or leave your email and we will tell you when something new ships.'}</p>
              {/*
                The counter.

                Rendered only when the count was actually taken. `total === null` means the read
                failed or the deployment has no list, and both must render nothing rather than "0
                people" — a zero is a real answer an empty list is entitled to give, and an
                unreachable database borrowing that answer would be the page stating a measurement it
                never made. This is the same rule the footer's package digest follows.

                Singular at one, because "1 people have joined" is the tell of a number nobody looked
                at.
              */}
              {total !== null && total > 0 && (
                <p style={{ margin: '1rem 0 0', textAlign: 'left', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>
                  <span style={{ color: CREST }}>{total.toLocaleString()}</span>
                  {total === 1 ? ' person on the list' : ' people on the list'}
                </p>
              )}
            </div>

            {gated && (<>
              <div style={{ maxWidth: '52rem', margin: '1.75rem 0 0', border: '1px solid rgba(var(--sand-rgb,217,201,163),0.35)', borderLeft: '3px solid var(--sand,#d9c9a3)', borderRadius: '10px', padding: '1rem 1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}>
                <p style={{ margin: '0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>Have an invitation? Enter your access code to go straight in.</p>
                <button className="dh-b46baf10" type="button" aria-expanded={showCode} aria-controls="wl-access-code" onClick={() => setShowCode((v) => !v)} style={{ flex: '0 0 auto', padding: '0.6rem 1.1rem', borderRadius: '10px', font: '600 0.875rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>Enter a code</button>
              </div>
              {showCode && (
                <form id="wl-access-code" onSubmit={(e) => { e.preventDefault(); void redeem(); }} style={{ maxWidth: '52rem', margin: '0.75rem 0 0', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', textAlign: 'left' }}>
                  <label style={{ flex: '1 1 16rem', display: 'grid', gap: '0.35rem' }}>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Access code</span>
                    <input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" disabled={redeeming} style={{ font: '500 1rem \'Geist Mono\',monospace', letterSpacing: '0.08em', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.3)', background: 'rgba(var(--pd,11,37,48),0.7)', color: 'var(--ink,#dce9e6)' }} />
                  </label>
                  <button className="dh-b46baf10" type="submit" disabled={redeeming || accessCode.trim() === ''} style={{ flex: '0 0 auto', padding: '0.6rem 1.1rem', borderRadius: '10px', font: '600 0.875rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>{redeeming ? 'Checking…' : 'Enter'}</button>
                  {codeError !== null && (
                    <p role="alert" style={{ flexBasis: '100%', margin: '0', fontSize: '0.9375rem', color: 'var(--alert,#f2a29b)', textWrap: 'pretty' }}>{codeError}</p>
                  )}
                </form>
              )}
            </>)}
            <div style={{ position: 'relative', height: '9rem', marginTop: '1rem', overflow: 'hidden' }}>
              <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }}></canvas>
            </div>

            {/*
              See what is here before committing to anything. Both sides are open to a visitor the
              gate would otherwise turn away — that is the funnel's whole job on this page.
            */}
            {funnel !== null && (
              <div style={{ marginTop: '1rem', marginBottom: '2.5rem' }}>
                <ExploreFunnel sides={funnel} />
              </div>
            )}

            <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,20rem),1fr))', alignItems: 'start', marginTop: '1rem' }}>
              <section aria-labelledby="wl-form-title" style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.94))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.6)', padding: '2rem' }}>
                <h2 id="wl-form-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>Join the list</h2>
                <p style={{ margin: '0.5rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>{gated ? 'Your email, and optionally the handle you would like. One message when the doors open.' : 'Your email, and optionally the handle you would like. One message when something new ships.'}</p>

                {/*
                    A grid track's automatic minimum is `min-content`, and a text input contributes
                    its own intrinsic width — about twenty characters — to that. With the
                    `weir.social/c/` prefix beside it the row's min-content came to 352px, so on a
                    360px phone the whole column was sized to 352px inside a 218px card: the email
                    field, the handle row and the button all rendered past the edge and were clipped
                    by the body, which is why the prefix read "weir.so" and stopped.

                    `minmax(0, 1fr)` lets the track shrink to its container, which is what
                    `globals.css` says about the shell's own centre column for the same reason.
                  */}
                <div style={{ marginTop: '1.75rem', display: 'grid', gap: '1.25rem', gridTemplateColumns: 'minmax(0, 1fr)' }}>
                  <div>
                    <label htmlFor="wlmail" style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Email</label>
                    <input id="wlmail" type="email" value={wlEmail} onChange={onWlEmail} placeholder="you@domain.com" style={{ marginTop: '0.5rem', width: '100%', background: 'var(--bg,#04161d)', border: `1px solid ${wlEmailBorder}`, borderRadius: '10px', padding: '0.7rem 0.95rem', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist\',sans-serif', fontSize: '0.9375rem', outline: 'none', transition: 'border-color 0.15s ease' }}/>
                  </div>

                  <div>
                    <label htmlFor="wlhandle" style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Handle you want <span style={{ textTransform: 'none', letterSpacing: '0' }}>(optional)</span></label>
                    <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--bg,#04161d)', border: '1px solid rgba(var(--line-rgb,28,61,71),0.9)', borderRadius: '10px', padding: '0.7rem 0.95rem' }}>
                      <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>weir.social/c/</span>
                      <input id="wlhandle" type="text" value={wlHandle} onChange={onWlHandle} placeholder="yourname" style={{ flex: '1', minWidth: '0', background: 'transparent', border: '0', outline: 'none', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.9375rem' }}/>
                    </div>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: `${wlHandleColor}` }}>{wlHandleNote}</p>
                  </div>

                  <div>
                    <span style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>You are</span>
                    <div role="radiogroup" aria-label="You are" style={{ marginTop: '0.625rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(wlRoles ?? []).map((r, i) => (<Fragment key={i}>
                        <button type="button" role="radio" aria-checked={r.checked} onClick={r.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1rem', borderRadius: '99px', cursor: 'pointer', font: '600 0.875rem \'Geist\',sans-serif', background: `${r.bg}`, color: `${r.color}`, border: `1px solid ${r.border}`, transition: 'border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>{r.icon}{r.label}</button>
                      </Fragment>))}
                    </div>
                  </div>

                  <button className="dh-72917cd5" type="button" onClick={onWlSubmit} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.85rem 1.35rem', borderRadius: '10px', font: '700 1rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 24px -6px rgba(var(--crest-rgb,139,227,198),0.6)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>{wlSubmitLabel}</button>

                  {wlHasResult && (<>
                    <div role="status" style={{ border: `1px solid ${wlResultBorder}`, borderLeft: `3px solid ${wlResultAccent}`, borderRadius: '10px', padding: '1.25rem 1.5rem', background: 'rgba(var(--pe,4,22,29),0.6)' }}>
                      <p style={{ margin: '0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: `${wlResultAccent}` }}>{wlResultIcon}{wlResultTitle}</p>
                      <p style={{ margin: '0.625rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>{wlResultBody}</p>
                      <p style={{ margin: '0.625rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{wlResultDetail}</p>
                    </div>
                  </>)}

                  {standing !== null && (
                    <div style={{ border: `1px solid ${LINE}`, borderLeft: `3px solid ${CREST}`, borderRadius: '10px', padding: '1.25rem 1.5rem', background: 'rgba(var(--pe,4,22,29),0.6)', display: 'grid', gap: '1rem' }}>
                      <div>
                        <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: CREST }}>Your place</p>
                        {/*
                          Stated as arrival order, never as a queue. `db/016_waitlist_growth.sql`
                          spells out why: this product is live, nobody is being served in turn, and
                          "you are 47th in line" would describe a process that does not exist. A
                          plain count claims arrival, not a position being served.

                          No ordinal suffix, and no noun left for one to strand on.

                          This read "You are number 47 th address to join". The suffix was a bare
                          literal, so it never agreed with the number in front of it — and no fixed
                          suffix could: 1 wants "st", 47 wants "th", 21 wants "st" again. The
                          cardinal form removes the agreement problem rather than solving it, and
                          is correct at 1, 47, 100 and 1,000,000 alike.

                          `position` is typed `number`, so the guard is not for `null` — it is for
                          a number that is not finite. `NaN.toLocaleString()` is "NaN", which would
                          print "You are number NaN on the list." to somebody who just joined.
                        */}
                        <p style={{ margin: '0.625rem 0 0', color: 'var(--ink,#dce9e6)', fontSize: '0.9375rem', textWrap: 'pretty' }}>
                          {Number.isFinite(standing.position) ? (
                            <>
                              You are number{' '}
                              <span style={{ fontFamily: '\'Geist Mono\',monospace', color: CREST }}>{standing.position.toLocaleString()}</span>
                              {' '}on the list.
                            </>
                          ) : (
                            'You are on the list.'
                          )}
                        </p>
                        {/*
                          Branches, because the gate can contradict it.

                          "Weir is already live and open to read" was unconditional, so a reader the
                          proxy had just turned away was told the door was open — by the very page
                          that had turned them away. Every other sentence here already reads
                          `gated`; this one now does too.
                        */}
                        <p style={{ margin: '0.4rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>
                          {gated
                            ? 'Arrival order, not a queue. Nothing is served in turn — the doors have not opened yet.'
                            : 'Arrival order, not a queue. Nothing is served in turn — Weir is already live and open to read.'}
                        </p>
                      </div>

                      <div>
                        <label htmlFor="wl-ref" style={{ display: 'block', marginBottom: '0.4rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: SAND }}>Invite a friend</label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            id="wl-ref"
                            readOnly
                            value={refLink}
                            onFocus={(e) => e.currentTarget.select()}
                            style={{ flex: '1 1 14rem', minWidth: '0', padding: '0.7rem 0.85rem', borderRadius: '8px', border: `1px solid ${LINE}`, background: 'rgba(var(--pb,9,32,42),0.7)', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem' }}
                          />
                          <button type="button" onClick={onCopyRef} style={{ flex: '0 0 auto', minHeight: '2.75rem', padding: '0.7rem 1.1rem', borderRadius: '8px', border: `1px solid ${CREST}`, background: 'rgba(var(--crest-rgb,139,227,198),0.08)', color: 'var(--ink,#dce9e6)', font: '600 0.9375rem \'Geist\',sans-serif', cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
                        </div>
                        {/*
                          What the link does and — load-bearing — what it does not. `creator.move`
                          has a real referral that splits a settlement and pays an address; this is
                          not it, and a page that let the two blur would be claiming a contract that
                          does not exist for this. See the header of `db/016_waitlist_growth.sql`.
                        */}
                        <p style={{ margin: '0.5rem 0 0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>
                          {standing.referred === 0
                            ? 'Nobody has joined through your link yet.'
                            : `${standing.referred.toLocaleString()} ${standing.referred === 1 ? 'person has' : 'people have'} joined through your link.`}{' '}
                          Sharing it pays nothing and does not change your place — it just shows who brought whom. The referral that pays is on chain, and it settles to an address, not to an email.
                        </p>
                      </div>
                    </div>
                  )}

            
                </div>
              </section>

              <div style={{ display: 'grid', gap: '1.5rem', alignContent: 'start' }}>
                {/*
                  Above "what being early gets you", because it answers the question that section
                  raises. Rendered only when a date exists — there is no placeholder state, and an
                  unset target is not a missing feature but the honest default.
                */}
                {launchTarget !== null && (
                  <Countdown atMs={launchTarget.atMs} label={launchTarget.label} gated={gated} />
                )}

                <section aria-labelledby="wl-get-title" style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.75rem' }}>
                  <h2 id="wl-get-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.25rem', letterSpacing: '-0.03em' }}>What you get</h2>
                  <ul style={{ margin: '1.25rem 0 0', padding: '0', listStyle: 'none', display: 'grid', gap: '1rem' }}>
                    {(wlPerks ?? []).map((p, i) => (<Fragment key={i}>
                      <li style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <span aria-hidden="true" style={{ color: 'var(--crest,#8be3c6)', display: 'inline-flex', paddingTop: '0.1rem' }}>{p.icon}</span>
                        <span style={{ minWidth: '0' }}>
                          <span style={{ display: 'block', fontWeight: '600', color: 'var(--ink,#dce9e6)', fontSize: '0.9375rem' }}>{p.title}</span>
                          <span style={{ display: 'block', marginTop: '0.2rem', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>{p.body}</span>
                        </span>
                      </li>
                    </Fragment>))}
                  </ul>
                </section>

                <section aria-label="How the list works" style={{ border: '1px solid rgba(var(--sand-rgb,217,201,163),0.3)', borderLeft: '3px solid var(--sand,#d9c9a3)', borderRadius: '10px', padding: '1.5rem' }}>
                  <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>How the list works</p>
                  {/* One paragraph, one claim per sentence, and nothing it says is contradicted elsewhere on the page. */}
                  <p style={{ margin: '0.625rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>No points, no tiers, no queue-jumping. Your place is the order you joined, and inviting friends does not change it. Your email is used to tell you when {gated ? 'the doors open' : 'something new ships'} and for nothing else — one click unsubscribes.</p>
                </section>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                  <a className="dh-237dddac" href="/security" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>Read the contracts</a>
                  {!gated && (<a className="dh-237dddac" href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>Look around the feed</a>)}
                </div>
              </div>
            </div>
          </div>
      {/* The honeypot. Off-screen rather than hidden, because a bot that skips hidden fields is the
          one this catches — and tab-skipped so no human and no screen reader reaches it. */}
      <label htmlFor={trapId} aria-hidden style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
        Company
        <input id={trapId} name="company" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </label>
    </>
  );
}
