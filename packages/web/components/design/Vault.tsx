'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude


import { Fragment } from 'react';

export function DesignVault({
  signedIn,
  myHandle,
  myInitials,
  vaultType,
  vaultVersion,
  vaultScanHref,
  vaultScanLabel,
  vaultFields,
  members,
}: {
  signedIn: boolean;
  myHandle: string;
  myInitials: string;
  vaultType: string;
  vaultVersion: string;
  vaultScanHref: string | undefined;
  vaultScanLabel: string;
  vaultFields: readonly { k: string; v: string }[];
  /**
   * Who is pooled behind this vault, read live. `null` when there is no vault to read — the
   * section is then absent rather than empty, because "no members" is a statement about a vault.
   */
  members: {
    rows: readonly {
      who: string;
      name: string | null;
      short: string;
      href: string | undefined;
      principal: string;
      share: string;
      claimable: string;
    }[];
    /** One sentence: the count, the sum, and whether it matches the vault's own total. */
    summary: string;
    reconciles: boolean;
  } | null;
}) {
  return (
    <>
          <div className="weir-page" style={{ maxWidth: '52rem', marginInline: 'auto', padding: '3rem 1.5rem 6rem' }}>
            <section aria-label="Vault owner" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
              <span aria-hidden="true" style={{ width: '3.5rem', height: '3.5rem', borderRadius: '50%', background: 'var(--line-2,#123039)', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--weir-mono)', fontSize: '1.0625rem', color: 'var(--crest,#8be3c6)', flexShrink: '0', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08)' }}>{myInitials}</span>
              <div style={{ minWidth: '0' }}>
                <p style={{ margin: '0 0 0.2rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.06em', color: 'var(--crest,#8be3c6)' }}>{myHandle}</p>
                <h1 style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.05', letterSpacing: '-0.034em', fontSize: 'clamp(1.75rem,1.2rem + 1.8vw,2.5rem)' }}><span className="weir-owned">My Vault</span></h1>
              </div>
            </section>
            <p style={{ margin: '1.125rem 0 0', maxWidth: '58ch', fontSize: '1.0625rem', lineHeight: '1.65', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>The deposit stays yours; the yield doesn't. Park SUI here and it is delegated to a validator. The staking yield goes to the creator; the principal never does. It is withdrawable in full, any time, with no lock-up, no notice and no approval from them or from us. That is not a policy: there is no function in the contract that lets anyone but you touch it.</p>

            <div style={{ height: '1px', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px)', marginBlock: '2.5rem' }}></div>

            <section aria-label="On-chain object" style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem' }}>
                <h3 style={{ margin: '0', fontFamily: '\'Geist\',sans-serif', fontWeight: '600', fontSize: '1.1875rem' }}>The object itself</h3>
                <a href={vaultScanHref} style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem' }}>{vaultScanLabel}</a>
              </div>
              <p style={{ margin: '1.25rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', wordBreak: 'break-all', color: 'var(--crest,#8be3c6)' }}>{vaultType}</p>
              <p style={{ margin: '0.25rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>version {vaultVersion}</p>
              <dl style={{ margin: '1.5rem 0 0', display: 'grid', gap: '0.5rem' }}>
                {(vaultFields ?? []).map((f, i) => (<Fragment key={i}>
                  <div className="weir-kv" style={{ display: 'grid', gridTemplateColumns: '12rem minmax(0,1fr)', gap: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--line,#1c3d47)' }}>
                    <dt style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{f.k}</dt>
                    <dd style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', wordBreak: 'break-all', color: 'var(--ink,#dce9e6)' }}>{f.v}</dd>
                  </div>
                </Fragment>))}
              </dl>
              <p style={{ margin: '1.25rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>Fields are shown as the chain holds them. Naming them here would be our reading of the object, not what it says.</p>
            </section>

            {members !== null && (
              <section aria-label="Community members" style={{ marginTop: '1.5rem', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem' }}>
                <h3 style={{ margin: '0', fontFamily: '\'Geist\',sans-serif', fontWeight: '600', fontSize: '1.1875rem' }}>Community members</h3>
                {/*
                  The one sentence under the heading is the reconciliation, and it is coloured by
                  whether it holds: the rows are read from the positions table and the total from
                  the vault, and the page says when they disagree rather than choosing one.
                */}
                <p style={{ margin: '0.5rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: members.reconciles ? 'var(--dim,#a3bcb8)' : 'var(--alert,#f2a29b)', textWrap: 'pretty' }}>{members.summary}</p>
                {members.rows.length > 0 && (
                  <div style={{ overflowX: 'auto', marginTop: '1.25rem' }}>
                    <table className="weir-members" style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem' }}>
                      <thead>
                        <tr>
                          {['member', 'principal', 'share', 'claimable now'].map((h, i) => (
                            <th key={i} scope="col" style={{ textAlign: i === 0 ? 'left' : 'right', fontWeight: '500', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)', padding: '0 0 0.5rem', borderBottom: '1px solid var(--line,#1c3d47)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {members.rows.map((r) => (<Fragment key={r.who}>
                          <tr>
                            <td style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--line,#1c3d47)', whiteSpace: 'nowrap' }}>
                              <a href={r.href} title={r.who} style={{ color: 'var(--ink,#dce9e6)', textDecoration: 'none' }}>{r.name ?? r.short}</a>
                              {r.name !== null && <span style={{ color: 'var(--dim,#a3bcb8)' }}> · {r.short}</span>}
                            </td>
                            <td data-label="principal" style={{ padding: '0.5rem 0 0.5rem 1rem', borderBottom: '1px solid var(--line,#1c3d47)', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--ink,#dce9e6)', fontVariantNumeric: 'tabular-nums' }}>{r.principal}</td>
                            <td data-label="share" style={{ padding: '0.5rem 0 0.5rem 1rem', borderBottom: '1px solid var(--line,#1c3d47)', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--dim,#a3bcb8)', fontVariantNumeric: 'tabular-nums' }}>{r.share}</td>
                            <td data-label="claimable now" style={{ padding: '0.5rem 0 0.5rem 1rem', borderBottom: '1px solid var(--line,#1c3d47)', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--crest,#8be3c6)', fontVariantNumeric: 'tabular-nums' }}>{r.claimable}</td>
                          </tr>
                        </Fragment>))}
                      </tbody>
                    </table>
                  </div>
                )}
                {/*
                  This described the query and named `claimable_rebate` — our implementation, on the
                  page where somebody checks their money. What they want to know is whether the
                  figure is current.
                */}
                <p style={{ margin: '1.25rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>Up to date as of this page load.</p>
              </section>
            )}

            <div style={{ marginTop: '1.5rem', border: '1px solid var(--line,#1c3d47)', borderLeft: '3px solid var(--sand,#d9c9a3)', borderRadius: '10px', padding: '1.25rem 1.5rem', maxWidth: '62ch' }}>
              <p style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Deposit & withdraw</p>
              <p style={{ margin: '0.5rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>Neither happens on this page. You pool from a creator's own page, where the amount is quoted and the transaction simulated before you are asked to sign; you withdraw from the support vault itself, reached from that page or from the Treasury. This panel reads the object and moves nothing.</p>
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button className="dh-f10f4630" type="button" onClick={() => { window.location.href = '/creator'; }} style={{ padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>Back to the creator studio</button>
            </div>
          </div>
    </>
  );
}
