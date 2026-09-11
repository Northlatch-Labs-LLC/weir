// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { Fragment } from 'react';
import { Freshness } from '@/components/design/Freshness';

export interface FunnelItem {
  href: string;
  name: string;
  handle: string;
  meta: string;
  agent?: true;
}

export interface FunnelSide {
  id: 'creators' | 'agents';
  kicker: string;
  title: string;
  lede: string;
  href: string;
  cta: string;
  items: readonly FunnelItem[];
  state: 'listed' | 'empty' | 'unmeasured';
  note: string;
  readAtMs: number;
}

export type FunnelSides = readonly [FunnelSide, FunnelSide];

export const AGENT_PILL_TITLE = 'Declared as an agent: the account and its operator each signed for it';

const MONO = 'var(--weir-mono)';
const CARD = {
  background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))',
  border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)',
  borderRadius: '10px',
  boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)',
} as const;

function Side({ side }: { side: FunnelSide }) {
  const titleId = `funnel-${side.id}-title`;
  const noteStyle =
    side.state === 'unmeasured'
      ? { color: 'var(--alert,#f2a29b)', fontStyle: 'italic' as const, fontFamily: "'Geist',sans-serif" }
      : side.state === 'empty'
        ? { color: 'var(--dim,#a3bcb8)', fontFamily: "'Geist',sans-serif" }
        : { color: 'var(--dim,#a3bcb8)', fontFamily: MONO };
  return (
    <section aria-labelledby={titleId} data-funnel-side={side.id} data-funnel-state={side.state} style={{ ...CARD, position: 'relative', overflow: 'hidden', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
      <span aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: '2px', background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))' }}></span>
      <p style={{ margin: 0, fontFamily: MONO, fontSize: '0.8125rem', fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>{side.kicker}</p>
      <h2 id={titleId} style={{ margin: 0, fontFamily: "'Geist',system-ui,sans-serif", fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em', color: 'var(--ink,#dce9e6)' }}>{side.title}</h2>
      <p style={{ margin: 0, color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{side.lede}</p>
      {side.items.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.625rem' }}>
          {side.items.map((item, i) => (<Fragment key={i}>
            <li>
              <a className="dh-cc3e1ebd" href={item.href} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0.75rem', borderRadius: '10px', border: '1px solid var(--line,#1c3d47)', textDecoration: 'none', transition: 'border-color 0.12s ease,transform 0.12s ease' }}>
                <span aria-hidden="true" style={{ width: '2.25rem', height: '2.25rem', borderRadius: '50%', background: 'var(--line-2,#123039)', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '0.75rem', color: 'var(--crest,#8be3c6)', flexShrink: 0 }}>{item.name.slice(0, 2)}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--ink,#dce9e6)' }}>{item.name}</span>
                    {item.agent === true && (
                      <span className="pill" title={AGENT_PILL_TITLE}>Agent</span>
                    )}
                  </span>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO, fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{item.handle}{item.meta === '' ? '' : ` · ${item.meta}`}</span>
                </span>
              </a>
            </li>
          </Fragment>))}
        </ul>
      )}
      <p style={{ margin: 0, fontSize: '0.875rem', textWrap: 'pretty', ...noteStyle }}>{side.note} <Freshness atMs={side.readAtMs} />.</p>
      <a className="dh-237dddac" href={side.href} style={{ alignSelf: 'flex-start', marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: 600, fontSize: '0.9375rem', lineHeight: 1, border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>{side.cta} →</a>
    </section>
  );
}

export function ExploreFunnel({ sides }: { sides: FunnelSides }) {
  return (
    <section aria-labelledby="funnel-title" style={{ maxWidth: '72rem', marginInline: 'auto' }}>
      <h2 id="funnel-title" style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Explore</h2>
      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,20rem),1fr))', alignItems: 'stretch' }}>
        {sides.map((side) => (
          <Side key={side.id} side={side} />
        ))}
      </div>
    </section>
  );
}
