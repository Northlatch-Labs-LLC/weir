'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * # Where the design supplies placement and this codebase supplies behaviour
 *
 * That split is deliberate. Re-deriving a Move call's entry-function arguments from a picture, for a
 * contract holding real balances, is the failure this project's own audit exists to prevent — and
 * those two components already carry quote simulation, blocker states and signature handling that no
 * amount of visual fidelity replaces.
 */

import { REGISTER_UNREAD_LINE, type DesignAgentIdentity } from '@/lib/agent-identity';
import { PageTabs } from '@/components/shell/PageTabs';
import { Fragment, type ReactNode } from 'react';
import { PostCard } from '@/components/PostCard';
import type { DesignFeedPost } from '@/components/design/Home';

export interface DesignTier {
  price: string;
  cadence: string;
  /** What the creator keeps, after the fee actually read from the Platform object. */
  net: string;
  /**
   * The control that buys *this* tier, rendered inside its own card.
   *
   * It belongs here rather than in the identity row. A single subscribe button at the top of the
   * page, with the prices several hundred pixels below it, asks somebody to commit before they have
   * seen what they are committing to — and gives them no way to say *which* tier they meant. A
   * purchase control sits with its price or it is not a purchase control.
   */
  action: ReactNode;
  /** True when the reader already holds this tier. The card then confirms rather than sells. */
  held: boolean;
}
export interface DesignStat {
  label: string;
  value: string;
  note: string;
  font: string;
  size: string;
  style: string;
  color: string;
}

export type CreatorTab = 'posts' | 'membership';

export function DesignCreator({
  signedIn,
  myHandle,
  profile,
  tiers,
  stats,
  profilePosts,
  viewingLabel,
  tiersHref,
  tiersLabel,
  subscribeSlot,
  depositSlot,
  depositLine,
  depositNote,
  vaultHref,
  depositShare,
  perks,
  perksGiven,
  perksPartial = false,
  supportersFirst = false,
  tipSlot,
  tab,
  tabHref,
}: {
  signedIn: boolean;
  myHandle: string | null;
  profile: {
    handle: string;
    displayName: string;
    bio: string;
    initials: string;
    /** "@handle · N followers", counted on this request. */
    meta: string;
    /** The creator's .sui name when they hold one, else the handle — never a guess. */
    sui: string;
    /**
     * What the declaration register says about this account. Absent renders nothing, exactly as
     * `none` does: a caller that did not look must not read as "looked, and no".
     */
    agent?: DesignAgentIdentity;
  };
  tiers: readonly DesignTier[];
  stats: readonly DesignStat[];
  profilePosts: readonly DesignFeedPost[];
  viewingLabel: string;
  tiersHref: string | undefined;
  tiersLabel: string;
  /** `FollowButton`, placed where the design puts the identity row's call to action. */
  subscribeSlot: ReactNode;
  /**
   * `DepositCheckout` — the *only* control in the pool card, and the only one that belongs there.
   */
  depositSlot: ReactNode;
  depositLine: string;
  /** A second line under the deposit control. Empty renders nothing. */
  depositNote: string;
  /** This creator's support vault page, when they have one. Absent hides the link. */
  vaultHref?: string;
  /** What this creator returns to depositors, when they return anything. Absent renders nothing. */
  depositShare?: string;
  /**
   * What a tip also brings, in the creator's words.
   *
   * `met` has three states on purpose: `true` earned, `false` a complete tally that fell short,
   * `undefined` we cannot say — a guest, a failed read, or a tally cut short by the ceiling.
   */
  perks?: readonly { title: string; detail: string; threshold: string; met?: boolean }[];
  /** What the viewer has given this creator in total, when it is known and above nothing. */
  perksGiven?: string;
  /** The tally is a lower bound: tips exist that the bounded walk did not reach. */
  perksPartial?: boolean;
  /** This creator says they answer supporters first. Their statement, not a rule we enforce. */
  supportersFirst?: boolean;
  /**
   * A tip is denominated in the creator's own coin and settles against the *creator* vault, which
   * is what the membership tiers above it buy from. The pool card is SUI, the stake vault, and a
   * principal that comes back — three things a tip is not. Mounting it there put an irreversible
   * payment under a heading promising the opposite.
   */
  tipSlot: ReactNode;
  /** Which of the page's two jobs is open. Posts by default; membership one tab away. */
  tab: CreatorTab;
  /** The address of each tab, with the reader carried along. */
  tabHref: Record<CreatorTab, string>;
}) {
  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
            <section className="weir-identity">
              <span aria-hidden="true" style={{ width: '4rem', height: '4rem', borderRadius: '50%', background: 'var(--line-2,var(--line-2,#123039))', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '1.125rem', color: 'var(--crest,#8be3c6)', flexShrink: '0', marginTop: '0.3rem' }}>{profile.initials}</span>
              <div className="weir-identity__text">
                <h1 style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.032em', fontSize: 'clamp(1.75rem,1.2rem + 1.8vw,2.5rem)', maxWidth: '36ch', textWrap: 'balance' }}>{profile.displayName}</h1>
                <p style={{ margin: '0.25rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontWeight: '500', fontSize: '0.9375rem', color: 'var(--crest,#8be3c6)' }}>{profile.meta}</p>
                {/*
                  The declaration register's answer, in the register's three states. `declared`
                  carries the same pill every post by this account carries, and the record a
                  reader can verify without trusting this page. `unread` is one quiet sentence with
                  no claim in it. `none` — and an absent prop — is nothing at all: no "human", no
                  "unverified", because the register proves declarations, never their absence.
                */}
                {profile.agent?.state === 'declared' && (
                  <div data-agent-identity="declared" style={{ margin: '0.625rem 0 0', maxWidth: '58ch' }}>
                    <p style={{ margin: '0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', fontSize: '0.9375rem', color: 'var(--ink-2,#b9cdc9)' }}>
                      <span className="pill" title="Declared as an agent — the account and its operator each signed for it">Agent</span>
                      <span>Declared agent · verified by two signatures · <a href={profile.agent.recordPath} style={{ color: 'var(--crest,#8be3c6)' }}>the record</a></span>
                    </p>
                    <details style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: 'var(--dim,#a3bcb8)' }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--dim,#a3bcb8)' }}>What it declared</summary>
                      <p style={{ margin: '0.375rem 0 0', lineHeight: '1.6', textWrap: 'pretty' }}>
                        Model: {profile.agent.model}. Purpose: {profile.agent.purpose}. {profile.agent.declared}. The two statements and signatures are at <a href={profile.agent.recordPath} style={{ color: 'var(--crest,#8be3c6)' }}>{profile.agent.recordPath}</a>; anyone can verify them without trusting this site.
                      </p>
                    </details>
                  </div>
                )}
                {profile.agent?.state === 'unread' && (
                  <p data-agent-identity="unread" style={{ margin: '0.625rem 0 0', fontSize: '0.875rem', fontStyle: 'italic', color: 'var(--alert,#f2a29b)' }}>{REGISTER_UNREAD_LINE}</p>
                )}
                {profile.bio !== '' && (<p style={{ margin: '0.875rem 0 0', maxWidth: '58ch', lineHeight: '1.65', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty', fontSize: '0.9375rem' }}>{profile.bio}</p>)}
              </div>
              {subscribeSlot}
            </section>

            <div style={{ height: '1px', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px)', marginBlock: '2.5rem' }}></div>

            {/*
              Two jobs, two tabs. Posts are what a visitor came for and open first; membership is
              one tap away rather than a screen of price cards above the first post. The pool stays
              in the aside on both, because it costs nothing and every creator page offers it.
            */}
            <PageTabs
              label="Creator page"
              items={[
                { label: 'Posts', href: tabHref.posts, icon: 'doc', note: String(profilePosts.length), current: tab === 'posts' },
                { label: 'Membership', href: tabHref.membership, icon: 'layers', note: String(tiers.length), current: tab === 'membership' },
              ]}
            />

            <div className="weir-cols weir-cols--22">
              <div style={{ display: 'grid', gap: '3rem' }}>
                {tab === 'membership' && (<>
                <section aria-label="Membership">
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <h2 className="sr-only" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}><span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>Membership</span></h2>
                    <a href={tiersHref} style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem' }}>{tiersLabel}</a>
                  </div>
                  <ul style={{ margin: '1.5rem 0 0', padding: '0', listStyle: 'none', display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,15rem),1fr))' }}>
                    {(tiers ?? []).map((t, i) => (<Fragment key={i}>
                      <li style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem' }}>
                        <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '1.5rem', fontWeight: '500', color: 'var(--ink,#dce9e6)' }}>{t.price}</p>
                        <p style={{ margin: '0.25rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>{t.cadence}</p>
                        <p style={{ margin: '1rem 0 0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', maxWidth: '62ch' }}>{t.net}</p>
                        {/* The control that buys THIS tier, beside the price it buys. */}
                        <div style={{ marginTop: '1rem' }}>{t.action}</div>
                      </li>
                    </Fragment>))}
                  </ul>
                  <div style={{ marginTop: '1.5rem', border: '1px solid var(--line,#1c3d47)', borderLeft: '3px solid var(--sand,#d9c9a3)', borderRadius: '10px', padding: '1rem 1.5rem', maxWidth: '62ch' }}>
                    <p style={{ margin: '0', fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>Tip</p>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>Send any amount, once. It settles on chain and the platform takes its usual fee; the rest lands in their vault. It buys no access and expires never; any perks below are the creator\u2019s own promise.</p>
                    {/*
                      The control the copy above describes.
                    */}
                    <div className="weir-tip" style={{ marginTop: '1rem' }}>{tipSlot}</div>
                  {perks !== undefined && perks.length > 0 && (
                      <div style={{ marginTop: '1.25rem' }}>
                        <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.75rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>What a tip also brings</p>
                        {perksGiven !== undefined && (
                          <p style={{ margin: '0.5rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)' }}>You have given {perksGiven}{perksPartial ? ' that we can see' : ''}</p>
                        )}
                        <ul style={{ margin: '0.875rem 0 0', padding: '0', listStyle: 'none', display: 'grid', gap: '0.625rem' }}>
                          {perks.map((perk, i) => (
                            <li key={i} style={{ display: 'grid', gap: '0.2rem', padding: '0.75rem 0.875rem', borderRadius: '8px', border: `1px solid ${perk.met === true ? 'rgba(var(--crest-rgb,139,227,198),0.45)' : 'var(--line,#1c3d47)'}`, background: perk.met === true ? 'rgba(var(--crest-rgb,139,227,198),0.06)' : 'transparent' }}>
                              <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem' }}>
                                <span style={{ fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>{perk.title}</span>
                                {/* The state is named in words, never by colour alone. */}
                                <span style={{ flex: '0 0 auto', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.6875rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: perk.met === true ? 'var(--crest,#8be3c6)' : 'var(--dim,#a3bcb8)' }}>{perk.met === true ? 'Yours' : `From ${perk.threshold}`}</span>
                              </span>
                              {perk.detail !== '' && (
                                <span style={{ fontSize: '0.875rem', lineHeight: '1.5', color: 'var(--ink-2,#b9cdc9)' }}>{perk.detail}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {supportersFirst && (
                          <p style={{ margin: '0.875rem 0 0', fontSize: '0.875rem', lineHeight: '1.5', color: 'var(--ink-2,#b9cdc9)' }}>This creator says they answer supporters first. Anyone with an account can message them; this is where they start.</p>
                        )}
                        {perksPartial && (
                          <p style={{ margin: '0.875rem 0 0', fontSize: '0.8125rem', lineHeight: '1.5', color: 'var(--sand,#d9c9a3)' }}>We read the most recent payments only, so your total may be higher than the figure above. If a perk you have earned is not marked, tell the creator — the chain has the record.</p>
                        )}
                        {/*
                          The label this list must carry.
                          Everything else on this page is enforced by a contract. A tip mints no
                          object, so nothing can hold a creator to what is written here, and a reader
                          who assumed otherwise would be assuming it because we let them.
                        */}
                        <p style={{ margin: '0.875rem 0 0', fontSize: '0.8125rem', lineHeight: '1.5', color: 'var(--dim,#a3bcb8)' }}>The tip settles on chain and cannot be reversed. These are the creator&rsquo;s own promises, kept by them — not by the contract.</p>
                      </div>
                    )}
                  </div>
                </section>

                <section aria-label="Settlement">
                  <p style={{ margin: '0 0 1rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Settled on chain</p>
                  <dl style={{ margin: '0', display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,10rem),1fr))' }}>
                    {(stats ?? []).map((s, i) => (<Fragment key={i}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <dt style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>{s.label}</dt>
                        <dd style={{ margin: '0', fontFamily: `${s.font}`, fontSize: `${s.size}`, fontWeight: '500', fontStyle: `${s.style}`, color: `${s.color}`, fontVariantNumeric: 'tabular-nums' }}>{s.value}</dd>
                        <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{s.note}</span>
                      </div>
                    </Fragment>))}
                  </dl>
                </section>
                </>)}

                {tab === 'posts' && (<>
                <section aria-label="Posts">
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', paddingBottom: '1rem', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px) bottom left / 100% 1px no-repeat' }}>
                    <h2 className="sr-only" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}><span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>Posts</span></h2>
                    <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.06em', color: 'var(--dim,#a3bcb8)' }}>{viewingLabel}</p>
                  </div>
                  <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1.25rem' }}>
                    {(profilePosts ?? []).map((post, i) => (<Fragment key={i}>
                      <PostCard post={post.post} price={post.price} reader={post.reader} entities={post.entities} authorIsAgent={post.authorIsAgent} />
                    </Fragment>))}
                  </div>
                </section>
                </>)}
              </div>

              <aside style={{ display: 'grid', alignContent: 'start', gap: '1.5rem', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '1.5rem' }}>
                <div>
                  <p style={{ margin: '0 0 0.75rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Below the waterline</p>
                  <h2 style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', lineHeight: '1.15', letterSpacing: '-0.03em' }}>Pool, <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>don't pay</span></h2>
                  <p style={{ margin: '0.75rem 0 0', color: 'var(--ink-2,#b9cdc9)', textShadow: '0 0 18px rgba(var(--crest-rgb,139,227,198),0.18)', fontSize: '0.9375rem', lineHeight: '1.6' }}>Park SUI in the vault of <strong style={{ color: 'var(--ink,#dce9e6)', fontWeight: '600' }}>{profile.sui}</strong>. It is delegated to a validator, the staking yield goes to them, and your principal stays yours — withdrawable in full at any time. The cost to you is the yield you would have earned yourself.</p>
                </div>
                <div>
                  <div className="weir-pool-deposit">{depositSlot}</div>
                  <p style={{ margin: '0.75rem 0 0', fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--ink-2,#b9cdc9)', textShadow: '0 0 18px rgba(var(--crest-rgb,139,227,198),0.18)' }}>{depositLine}</p>
                  {depositNote !== '' && (<p style={{ margin: '0.5rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', lineHeight: '1.55', color: 'var(--ink-2,#b9cdc9)', textShadow: '0 0 18px rgba(var(--crest-rgb,139,227,198),0.18)' }}>{depositNote}</p>)}
                  {depositShare !== undefined && (
                    <p style={{ margin: '0.75rem 0 0', padding: '0.75rem 0.875rem', borderRadius: '8px', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--ink-2,#b9cdc9)' }}>{depositShare}</p>
                  )}
                </div>
                {vaultHref !== undefined && (<a className="dh-f2bac7c4" href={vaultHref} style={{ width: '100%', display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box', padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>Inspect the vault object</a>)}
              </aside>
            </div>
          </div>
    </>
  );
}
