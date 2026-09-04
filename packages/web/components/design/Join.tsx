'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * # Configure here, sign on `/join`
 *
 * # The fee is read
 */

import { PageHead } from '@/components/design/PageHead';
import { Fragment, useState } from 'react';
import { useHandleAvailability } from '@/components/design/use-handle-availability';
import { handleShapeProblem } from '@/lib/waitlist';

const CREST = 'var(--crest,#8be3c6)';
const DIM = 'var(--dim,#a3bcb8)';
const ALERT = 'var(--alert,#f2a29b)';
const SAND = 'var(--sand,#d9c9a3)';

export function DesignJoin({
  signedIn,
  myHandle,
  feeBps,
}: {
  signedIn: boolean;
  myHandle: string | null;
  /** Live, from the Platform object. Null when it could not be read. */
  feeBps: number | null;
}) {
  const [joinHandle, setHandle] = useState('');
  const [joinTier, setTier] = useState('10');
  const [joinYield, setYield] = useState(15);
  const [joinDone, setDone] = useState(false);

  const isGuest = !signedIn;
  /* Setup opens only to a proved session: a page belongs to an address, not to an account we hold. */
  const showJoinForm = signedIn && !joinDone;

  const availability = useHandleAvailability(joinHandle);
  const shape = handleShapeProblem(joinHandle);
  const handleNote =
    joinHandle.trim() === ''
      ? 'Three or more characters: lowercase letters, numbers and underscores.'
      : shape !== null
        ? shape
        : availability === 'checking'
          ? 'Checking the registry…'
          : availability === 'taken'
            ? `@${joinHandle.toLowerCase()} is taken; it resolves to a page already on chain.`
            : availability === 'available'
              ? `@${joinHandle.toLowerCase()} is free. It stays first-come until the transaction mints it.`
              : availability === 'unreadable'
                ? 'We could not reach the registry, so this is unchecked rather than free.'
                : '';
  const handleNoteColor =
    shape !== null || availability === 'taken'
      ? ALERT
      : availability === 'unreadable'
        ? SAND
        : availability === 'available'
          ? CREST
          : DIM;

  const feeLabel = feeBps === null ? 'a platform fee' : `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  /*
    What the creator keeps, in the contract's own arithmetic: integer basis points, rounded down.
    Quoting a creator a fraction more than settlement will actually pay them is a small lie that
    repeats on every payment.
  */
  const tier = Number(joinTier);
  const joinNet =
    !Number.isFinite(tier) || tier < 0
      ? 'not a number'
      : feeBps === null
        ? 'not measured'
        : `${((tier * (10000 - feeBps)) / 10000).toFixed(4).replace(/\.?0+$/, '')} per period`;

  const joinYieldLabel = `${joinYield}%`;
  const yieldNote =
    joinYield === 0
      ? 'You keep all of it. Perfectly normal, and the number is public, so say why if you like.'
      : `Poolers get ${joinYield}% of the yield their deposit earns; you keep ${100 - joinYield}%. It is written on the object, so nobody has to trust you to keep it there.`;

  const onJoinHandle = (e: React.ChangeEvent<HTMLInputElement>) => setHandle(e.target.value);
  const onJoinTier = (e: React.ChangeEvent<HTMLInputElement>) => setTier(e.target.value);
  const onJoinYield = (e: React.ChangeEvent<HTMLInputElement>) => setYield(Number(e.target.value));

  const clean = joinHandle.trim().replace(/^@/, '').toLowerCase();
  const joinSummaryTitle = clean === '' ? 'Your page' : `weir.social/c/${clean}`;
  const joinSummary = [
    { label: 'Handle', value: clean === '' ? 'not set' : `@${clean}` },
    { label: 'Monthly tier', value: Number.isFinite(tier) ? `${tier} USDC` : 'not a number' },
    { label: 'You keep', value: `${joinNet} (${feeLabel} at settlement)` },
    { label: 'Yield shared back', value: joinYieldLabel },
    { label: 'Objects created', value: '1 tier object, 1 creator vault' },
  ];

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '48rem', marginInline: 'auto', padding: '3rem 1.5rem 6rem' }}>
            <PageHead
              centered
              kicker="For creators"
              title="Two revenue lines."
              accent="One page."
              lede={`Subscriptions and unlocks settle on chain and we take ${feeLabel} at settlement. The pool costs your supporters nothing they keep, and it is the line that converts the people who will never subscribe.`}
            />

            {isGuest && (<>
              <div style={{ border: '1px solid var(--line,#1c3d47)', borderLeft: '3px solid var(--sand,#d9c9a3)', borderRadius: '10px', padding: '1.25rem 1.5rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <p style={{ margin: '0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>A page belongs to an address, not to an account we hold. Sign in first and the setup below unlocks.</p>
                <button className="dh-f2bac7c4" type="button" onClick={() => { window.location.href = '/signin'; }} style={{ flexShrink: '0', padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>Sign in to start</button>
              </div>
            </>)}

            {showJoinForm && (<>
              <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'minmax(0, 1fr)', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '2rem' }}>
                <div>
                  <label htmlFor="jh" style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Handle</label>
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', padding: '0.6rem 0.875rem' }}>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>weir.social/c/</span>
                    <input id="jh" type="text" value={joinHandle} onChange={onJoinHandle} placeholder="yourname" style={{ flex: '1', minWidth: '0', background: 'transparent', border: '0', outline: 'none', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.9375rem' }}/>
                  </div>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.9375rem', color: `${handleNoteColor}` }}>{handleNote}</p>
                </div>

                <div style={{ paddingTop: '2rem', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px) top left / 100% 1px no-repeat' }}>
                  <label htmlFor="jt" style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Monthly tier</label>
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input id="jt" type="number" min="0" step="0.5" value={joinTier} onChange={onJoinTier} style={{ width: '8rem', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', padding: '0.6rem 0.875rem', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.9375rem' }}/>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>USDC · every 30 days</span>
                  </div>
                  <p style={{ margin: '1rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>You keep <span style={{ fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', color: 'var(--ink,#dce9e6)', fontWeight: '500' }}>{joinNet}</span> of every payment. The {feeLabel} is taken at settlement, in the same transaction, computed here with the integer maths the contract uses, not a rounded estimate.</p>
                </div>

                <div style={{ paddingTop: '2rem', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px) top left / 100% 1px no-repeat' }}>
                  <label htmlFor="jy" style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Yield shared back to supporters</label>
                  <div style={{ marginTop: '0.875rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <input id="jy" type="range" min="0" max="50" step="1" value={joinYield} onChange={onJoinYield} style={{ flex: '1', minWidth: '0' }}/>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '1.5rem', fontWeight: '500', color: 'var(--ink,#dce9e6)', minWidth: '4rem', textAlign: 'right' }}>{joinYieldLabel}</span>
                  </div>
                  <p style={{ margin: '1rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>{yieldNote}</p>
                </div>

                <div style={{ paddingTop: '2rem', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px) top left / 100% 1px no-repeat', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                  <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)', maxWidth: '36ch' }}>Creates a tier object and a vault owned by your address. One transaction.</p>
                  <button className="dh-f2bac7c4" type="button" onClick={() => { window.location.href = '/join'; }} style={{ padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>Review and sign</button>
                </div>
              </div>
            </>)}

            {joinDone && (<>
              <div style={{ background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '2rem' }}>
                <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Ready to sign</p>
                <h2 style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>{joinSummaryTitle}</h2>
                <dl style={{ margin: '1.5rem 0 0', display: 'grid', gap: '1rem' }}>
                  {(joinSummary ?? []).map((row, i) => (<Fragment key={i}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', alignItems: 'baseline' }}>
                      <dt style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)', minWidth: '12rem' }}>{row.label}</dt>
                      <dd style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.9375rem', color: 'var(--ink,#dce9e6)' }}>{row.value}</dd>
                    </div>
                  </Fragment>))}
                </dl>
                <p style={{ margin: '1.5rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>Nothing has been sent. The next step is one transaction your wallet signs; the digest appears here when it lands.</p>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
                  <button className="dh-f10f4630" type="button" onClick={() => setDone(false)} style={{ padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>Edit the setup</button>
                </div>
              </div>
            </>)}

            {/*
              The share, explained where a creator decides whether to set one.

              Outside the sign-in gate deliberately: the form above only renders for a signed-in
              address, and this is the argument somebody reads *before* they have one.
            */}
            <section data-reveal aria-labelledby="share-title" style={{ marginTop: '3rem', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '2rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>The share you can set</p>
              <h2 id="share-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>Give back part of the yield, <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>and backing you costs nothing</span></h2>
              <p style={{ margin: '1rem 0 0', maxWidth: '62ch', fontSize: '0.9375rem', lineHeight: '1.65', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>When a rung matures the deposit comes out first, then the platform fee. What is left is yours, and the share is taken from that: your money, never the platform&rsquo;s cut. Each supporter&rsquo;s part accrues in proportion to what they deposited, and they claim it themselves.</p>
              <p style={{ margin: '1rem 0 0', maxWidth: '62ch', fontSize: '0.9375rem', lineHeight: '1.65', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>The number lives on the vault object where anyone can read it, so nobody has to be trusted to honour it. Set it above zero and pooling behind you costs a supporter nothing they keep and pays them a little for staying, which is the part of an audience a subscription never reaches.</p>
            </section>
          </div>
    </>
  );
}
