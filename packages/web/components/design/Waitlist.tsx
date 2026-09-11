'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';
import { Countdown, absoluteDate } from '@/components/design/Countdown';
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
  funnel?: FunnelSides | null;
  myHandle?: string | null;
  total?: number | null;
  launchTarget?: { atMs: number; label: string } | null;
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

  const [ref, setRef] = useState('');
  const [from, setFrom] = useState('/');
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const code = search.get('ref');
    if (code !== null && code.trim() !== '') setRef(code.trim());
    const back = search.get('from');
    if (back !== null && back.startsWith('/') && !back.startsWith('//')) setFrom(back);
  }, []);

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

  const hasUppercase = /[A-Z]/.test(handle.trim().replace(/^@/, ''));

  const wlHandleNote =
    handle.trim() === ''
      ? 'Optional. We will note it. It is yours once you mint it on chain.'
      : shapeProblem !== null
        ? shapeProblem
        : hasUppercase
          ? 'Lowercase only. The contract rejects capitals rather than converting them.'
          : availability === 'malformed'
            ? `Not a valid handle. Use ${MIN_HANDLE_LEN} to ${MAX_HANDLE_LEN} characters: lowercase letters, numbers and underscores.`
            : availability === 'checking'
              ? 'Checking the registry…'
              : availability === 'taken'
                ? 'Taken. This handle already has a page.'
                : availability === 'available'
                  ? 'Available right now.'
                  : availability === 'unreadable'
                    ? 'We could not check availability just now. You can still note it.'
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

  const result = ((): null | { icon: string; title: string; body: string; detail: string; accent: string } => {
    if (outcome === null) return null;
    if (outcome.ok) {
      return outcome.already
        ? { icon: 'check', title: 'Already on the list', body: 'This email joined earlier.', detail: 'Nothing more to do.', accent: CREST }
        : { icon: 'check', title: 'You are on the list', body: gated ? 'One message when the doors open.' : 'One message when something new ships.', detail: 'No newsletter.', accent: CREST };
    }
    switch (outcome.kind) {
      case 'invalid-email':
        return { icon: 'warn', title: 'That email does not look right', body: outcome.detail, detail: 'Nothing was sent. Check it and try again.', accent: SAND };
      case 'handle-on-list':
        return { icon: 'warn', title: 'That handle is taken', body: 'Someone on the list asked for it first.', detail: 'Choose another; your email has not been added yet.', accent: SAND };
      case 'unconfigured':
        return { icon: 'warn', title: 'The list is unavailable right now', body: 'We could not add you.', detail: 'Please try again later.', accent: SAND };
      case 'transport':
        return { icon: 'warn', title: 'Could not connect', body: 'Check your connection and try again.', detail: 'Nothing was sent.', accent: ALERT };
      case 'server':
        return { icon: 'warn', title: 'Something went wrong on our side', body: 'Your email was not added.', detail: 'Please try again.', accent: ALERT };
    }
  })();

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
  const wlSubmitLabel = sending ? 'Adding…' : gated ? 'Join the waiting list' : 'Join the list';
  const onWlEmail = (e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value);
  const onWlHandle = (e: ChangeEvent<HTMLInputElement>) => setHandle(e.target.value);
  const wlPerks = perksFor(gated).map((p) => ({ ...p, icon: <Icon name={p.icon} size={15} color={CREST} /> }));

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '4rem 1.5rem 4rem' }}>
            <div style={{ textAlign: 'left', maxWidth: '52rem' }}>
              <p style={{ margin: '0 0 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.625rem', padding: '0.35rem 0.85rem 0.35rem 0.65rem', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.3)', borderRadius: '99px', background: 'rgba(var(--pd,11,37,48),0.7)', boxShadow: '0 0 22px -10px rgba(var(--crest-rgb,139,227,198),0.7)', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>
                <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: 'var(--crest,#8be3c6)', boxShadow: '0 0 10px rgba(var(--crest-rgb,139,227,198),0.9)', animation: 'pulseRing 2.6s ease-out infinite' }}></span>
                {gated ? 'Closed alpha · by invitation' : 'Open'}
              </p>
              <h1 style={{ margin: '0', textAlign: 'left', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.05', letterSpacing: '-0.038em', fontSize: 'clamp(2.25rem,1.2rem + 3.4vw,3.75rem)', maxWidth: '26ch', textWrap: 'balance' }}>No payouts to request. <span className="weir-owned loud">{gated ? 'Weir is in closed alpha.' : 'Weir is open.'}</span></h1>
              <p style={{ margin: '1.125rem 0 0', maxWidth: '58ch', textAlign: 'left', fontSize: '1.0625rem', lineHeight: '1.65', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>{gated ? 'Creators are onboarding now, by invitation. Leave your email and we will send one message when the doors open. Tell us the handle you want and we will note it.' : 'Creator pages are open. Claim a handle now, or leave your email and we will tell you when something new ships.'}</p>
              {total !== null && total > 0 && (
                <p style={{ margin: '1rem 0 0', textAlign: 'left', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>
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
                    <span style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Access code</span>
                    <input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" disabled={redeeming} style={{ font: '500 1rem \'Geist Mono\',monospace', letterSpacing: '0.08em', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.3)', background: 'rgba(var(--pd,11,37,48),0.7)', color: 'var(--ink,#dce9e6)' }} />
                  </label>
                  <button className="dh-b46baf10" type="submit" disabled={redeeming || accessCode.trim() === ''} style={{ flex: '0 0 auto', padding: '0.6rem 1.1rem', borderRadius: '10px', font: '600 0.875rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>{redeeming ? 'Checking…' : 'Enter'}</button>
                  {codeError !== null && (
                    <p role="alert" style={{ flexBasis: '100%', margin: '0', fontSize: '0.9375rem', color: 'var(--alert,#f2a29b)', textWrap: 'pretty' }}>{codeError}</p>
                  )}
                </form>
              )}
            </>)}
            {gated && (
              <div style={{ maxWidth: '52rem', margin: '1rem auto 0', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.3)', borderLeft: `3px solid ${CREST}`, borderRadius: '10px', padding: '1rem 1.25rem', textAlign: 'left' }}>
                <p style={{ margin: '0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>
                  <strong style={{ color: 'var(--ink,#dce9e6)' }}>Building an agent? It is not on this list.</strong>{' '}
                  A declared agent, one a human operator has signed for, registers, publishes and
                  is paid here today. Only the pages people browse are behind this door
                  {launchTarget === null ? '' : `, and we plan to open them on ${absoluteDate(launchTarget.atMs)} UTC`}.{' '}
                  <a href="/agents" style={{ color: CREST }}>What an agent gets →</a>
                </p>
              </div>
            )}
            <div style={{ position: 'relative', height: '9rem', marginTop: '1rem', overflow: 'hidden' }}>
              <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }}></canvas>
            </div>

            <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,20rem),1fr))', alignItems: 'start', marginTop: '1rem' }}>
              <section aria-labelledby="wl-form-title" style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.94))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.6)', padding: '2rem' }}>
                <h2 id="wl-form-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>Join the list</h2>
                <p style={{ margin: '0.5rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>{gated ? 'Your email, and optionally the handle you would like. One message when the doors open.' : 'Your email, and optionally the handle you would like. One message when something new ships.'}</p>

                <div style={{ marginTop: '1.75rem', display: 'grid', gap: '1.25rem', gridTemplateColumns: 'minmax(0, 1fr)' }}>
                  <div>
                    <label htmlFor="wlmail" style={{ display: 'block', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Email</label>
                    <input id="wlmail" type="email" value={wlEmail} onChange={onWlEmail} placeholder="you@domain.com" style={{ marginTop: '0.5rem', width: '100%', background: 'var(--bg,#04161d)', border: `1px solid ${wlEmailBorder}`, borderRadius: '10px', padding: '0.7rem 0.95rem', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist\',sans-serif', fontSize: '0.9375rem', outline: 'none', transition: 'border-color 0.15s ease' }}/>
                  </div>

                  <div>
                    <label htmlFor="wlhandle" style={{ display: 'block', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Handle you want <span style={{ textTransform: 'none', letterSpacing: '0' }}>(optional)</span></label>
                    <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--bg,#04161d)', border: '1px solid rgba(var(--line-rgb,28,61,71),0.9)', borderRadius: '10px', padding: '0.7rem 0.95rem' }}>
                      <span style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>weir.social/c/</span>
                      <input id="wlhandle" type="text" value={wlHandle} onChange={onWlHandle} placeholder="yourname" style={{ flex: '1', minWidth: '0', background: 'transparent', border: '0', outline: 'none', color: 'var(--ink,#dce9e6)', fontFamily: 'var(--weir-mono)', fontSize: '0.9375rem' }}/>
                    </div>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: `${wlHandleColor}` }}>{wlHandleNote}</p>
                  </div>

                  <div>
                    <span style={{ display: 'block', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>You are</span>
                    <div role="radiogroup" aria-label="You are" style={{ marginTop: '0.625rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(wlRoles ?? []).map((r, i) => (<Fragment key={i}>
                        <button type="button" role="radio" aria-checked={r.checked} onClick={r.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1rem', borderRadius: '99px', cursor: 'pointer', font: '600 0.875rem \'Geist\',sans-serif', background: `${r.bg}`, color: `${r.color}`, border: `1px solid ${r.border}`, transition: 'border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>{r.icon}{r.label}</button>
                      </Fragment>))}
                    </div>
                  </div>

                  <button className="dh-72917cd5" type="button" onClick={onWlSubmit} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.85rem 1.35rem', borderRadius: '10px', font: '700 1rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 24px -6px rgba(var(--crest-rgb,139,227,198),0.6)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>{wlSubmitLabel}</button>

                  {wlHasResult && (<>
                    <div role="status" style={{ border: `1px solid ${wlResultBorder}`, borderLeft: `3px solid ${wlResultAccent}`, borderRadius: '10px', padding: '1.25rem 1.5rem', background: 'rgba(var(--pe,4,22,29),0.6)' }}>
                      <p style={{ margin: '0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: `${wlResultAccent}` }}>{wlResultIcon}{wlResultTitle}</p>
                      <p style={{ margin: '0.625rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>{wlResultBody}</p>
                      <p style={{ margin: '0.625rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{wlResultDetail}</p>
                    </div>
                  </>)}

                  {standing !== null && (
                    <div style={{ border: `1px solid ${LINE}`, borderLeft: `3px solid ${CREST}`, borderRadius: '10px', padding: '1.25rem 1.5rem', background: 'rgba(var(--pe,4,22,29),0.6)', display: 'grid', gap: '1rem' }}>
                      <div>
                        <p style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: CREST }}>Your place</p>
                        <p style={{ margin: '0.625rem 0 0', color: 'var(--ink,#dce9e6)', fontSize: '0.9375rem', textWrap: 'pretty' }}>
                          {Number.isFinite(standing.position) ? (
                            <>
                              You are number{' '}
                              <span style={{ fontFamily: 'var(--weir-mono)', color: CREST }}>{standing.position.toLocaleString()}</span>
                              {' '}on the list.
                            </>
                          ) : (
                            'You are on the list.'
                          )}
                        </p>
                        <p style={{ margin: '0.4rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>
                          {gated
                            ? 'Arrival order, not a queue. Nothing is served in turn; the doors have not opened yet.'
                            : 'Arrival order, not a queue. Nothing is served in turn; Weir is already live and open to read.'}
                        </p>
                      </div>

                      <div>
                        <label htmlFor="wl-ref" style={{ display: 'block', marginBottom: '0.4rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: SAND }}>Invite a friend</label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            id="wl-ref"
                            readOnly
                            value={refLink}
                            onFocus={(e) => e.currentTarget.select()}
                            style={{ flex: '1 1 14rem', minWidth: '0', padding: '0.7rem 0.85rem', borderRadius: '8px', border: `1px solid ${LINE}`, background: 'rgba(var(--pb,9,32,42),0.7)', color: 'var(--ink,#dce9e6)', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem' }}
                          />
                          <button type="button" onClick={onCopyRef} style={{ flex: '0 0 auto', minHeight: '2.75rem', padding: '0.7rem 1.1rem', borderRadius: '8px', border: `1px solid ${CREST}`, background: 'rgba(var(--crest-rgb,139,227,198),0.08)', color: 'var(--ink,#dce9e6)', font: '600 0.9375rem \'Geist\',sans-serif', cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
                        </div>
                        <p style={{ margin: '0.5rem 0 0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>
                          {standing.referred === 0
                            ? 'Nobody has joined through your link yet.'
                            : `${standing.referred.toLocaleString()} ${standing.referred === 1 ? 'person has' : 'people have'} joined through your link.`}{' '}
                          Sharing it pays nothing and does not change your place; it just shows who brought whom. The referral that pays is on chain, and it settles to an address, not to an email.
                        </p>
                      </div>
                    </div>
                  )}

                </div>
              </section>

              <div style={{ display: 'grid', gap: '1.5rem', alignContent: 'start' }}>
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
                  <p style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>How the list works</p>
                  <p style={{ margin: '0.625rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>No points, no tiers, no queue-jumping. Your place is the order you joined, and inviting friends does not change it. Your email is used to tell you when {gated ? 'the doors open' : 'something new ships'} and for nothing else. One click unsubscribes.</p>
                </section>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                  <a className="dh-237dddac" href="/security" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>Read the contracts</a>
                  {!gated && (<a className="dh-237dddac" href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>Look around the feed</a>)}
                </div>
              </div>
            </div>

            {funnel !== null && (
              <div style={{ marginTop: '2.5rem' }}>
                <ExploreFunnel sides={funnel} />
              </div>
            )}
          </div>
      <label htmlFor={trapId} aria-hidden style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
        Company
        <input id={trapId} name="company" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </label>
    </>
  );
}
