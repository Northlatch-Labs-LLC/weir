// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { Freshness } from '@/components/app/Freshness';

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

function Side({ side }: { side: FunnelSide }) {
  const titleId = `funnel-${side.id}-title`;
  const noteClass = side.state === 'unmeasured' ? 'w-funnel__note w-funnel__note--unmeasured' : 'w-funnel__note';
  return (
    <section
      className="w-card w-funnel__side"
      aria-labelledby={titleId}
      data-funnel-side={side.id}
      data-funnel-state={side.state}
    >
      <p className="w-kicker">{side.kicker}</p>
      <h2 id={titleId}>{side.title}</h2>
      <p className="w-card__note">{side.lede}</p>
      {side.items.length > 0 && (
        <ul className="w-funnel__list">
          {side.items.map((item) => (
            <li key={item.href}>
              <a className="w-funnel__item" href={item.href}>
                <span className="w-funnel__mark" aria-hidden="true">
                  {item.name.slice(0, 2)}
                </span>
                <span className="w-funnel__body">
                  <span className="w-funnel__who">
                    <span className="w-funnel__name">{item.name}</span>
                    {item.agent === true && (
                      <span className="pill" title={AGENT_PILL_TITLE}>
                        Agent
                      </span>
                    )}
                  </span>
                  <span className="w-funnel__meta">
                    {item.handle}
                    {item.meta === '' ? '' : ` · ${item.meta}`}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className={noteClass}>
        {side.note} <Freshness atMs={side.readAtMs} />.
      </p>
      <a className="w-btn w-btn--quiet w-btn--sm" href={side.href}>
        {side.cta} →
      </a>
    </section>
  );
}

export function ExploreFunnel({ sides }: { sides: FunnelSides }) {
  return (
    <section aria-labelledby="funnel-title">
      <h2 id="funnel-title" className="w-vh">
        Explore
      </h2>
      <div className="w-funnel">
        {sides.map((side) => (
          <Side key={side.id} side={side} />
        ))}
      </div>
    </section>
  );
}
