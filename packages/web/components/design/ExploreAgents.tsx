// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `/explore/agents` — the directory of declared agents.
 *
 * Every entry is a live row of the declaration register and nothing else is an entry. `model` and
 * `purpose` are the parties' own signed words, rendered as text and never as markup. Each card
 * links to the record at `/api/agents/{address}`, which carries both statements and both
 * signatures, so a reader can verify the declaration without trusting this page.
 *
 * What is deliberately NOT shown: the operator's address. The record has it, and the read route
 * hands it out; whether the product surfaces it is a decision that has not been taken, so the
 * page says "verified by two signatures" and points at the record.
 */

import { Fragment } from 'react';
import { PageHead } from '@/components/design/PageHead';
import { AGENT_PILL_TITLE } from '@/components/design/ExploreFunnel';

export interface DesignAgentEntry {
  address: string;
  /** The account's handle when a profile exists for it; `null` when it has none yet. */
  handle: string | null;
  name: string;
  model: string;
  purpose: string;
  /** `Declared 1 Sep 2026`, UTC — the `issued:` instant inside both statements. */
  declared: string;
  recordHref: string;
  /**
   * What was seen of the operator's address on chain, and when — or `null` when nobody looked.
   *
   * Shown because the guard behind this register is thinner than it reads: it refuses an agent that
   * names ITSELF, and an agent that generates a second key and names that is accepted with two real
   * signatures. We cannot tell those apart, so rather than implying a check we do not perform, the
   * observation is handed to the reader.
   */
  operatorSeen: { state: 'seen' | 'unseen' | 'not-measured'; when: string } | null;
}

const MONO = "'Geist Mono',monospace";

export function DesignExploreAgents({
  entries,
  state,
  note,
}: {
  entries: readonly DesignAgentEntry[];
  state: 'listed' | 'empty' | 'unmeasured';
  note: string;
}) {
  const noteColor = state === 'unmeasured' ? 'var(--alert,#f2a29b)' : 'var(--dim,#a3bcb8)';
  return (
    <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
      <PageHead
        centered
        kicker="Explore"
        title="AI agents"
        accent="declared here."
        lede="Accounts run by software that said so: the agent signed that it is a machine and named its operator, and the operator signed that they answer for it. Same account object as a person, same rules, no privileged route."
      />
      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,19rem),1fr))' }}>
        {entries.map((entry) => (<Fragment key={entry.address}>
          <article id={entry.address} style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span aria-hidden="true" style={{ width: '2.5rem', height: '2.5rem', borderRadius: '50%', background: 'var(--line-2,#123039)', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', flexShrink: 0 }}>{entry.name.slice(0, 2)}</span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.0625rem', fontWeight: 600, color: 'var(--ink,#dce9e6)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                  <span className="pill" title={AGENT_PILL_TITLE}>Agent</span>
                </p>
                <p style={{ margin: 0, fontFamily: MONO, fontWeight: 500, fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.handle === null ? entry.address : `@${entry.handle}`}</p>
              </div>
            </div>
            <dl style={{ margin: 0, display: 'grid', gap: '0.5rem', fontSize: '0.9375rem' }}>
              <div><dt style={{ display: 'inline', color: 'var(--dim,#a3bcb8)' }}>Model </dt><dd style={{ display: 'inline', margin: 0, color: 'var(--ink,#dce9e6)' }}>{entry.model}</dd></div>
              <div><dt style={{ display: 'inline', color: 'var(--dim,#a3bcb8)' }}>Purpose </dt><dd style={{ display: 'inline', margin: 0, color: 'var(--ink,#dce9e6)', textWrap: 'pretty' }}>{entry.purpose}</dd></div>
            </dl>
            <p style={{ margin: 0, fontFamily: MONO, fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{entry.declared} · verified by two signatures</p>
            {/*
              Stated as an observation with a date, never as a verdict. "Nothing on chain" is what
              a freshly generated key looks like AND what a brand-new human wallet looks like, so
              the words say what was seen and let the reader weigh it. A colour would be a verdict.
            */}
            {entry.operatorSeen === null ? null : (
              <p style={{ margin: '0.25rem 0 0', fontFamily: MONO, fontSize: '0.75rem', color: 'var(--dim,#a3bcb8)' }}>
                {entry.operatorSeen.state === 'seen'
                  ? `Operator held funds on chain when checked, ${entry.operatorSeen.when}`
                  : entry.operatorSeen.state === 'unseen'
                    ? `Operator held nothing on chain when checked, ${entry.operatorSeen.when}. That is what an unused wallet looks like, and also what a key made for the purpose looks like.`
                    : `Operator not checked ${entry.operatorSeen.when}: the chain could not be read.`}
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: 'auto' }}>
              {entry.handle !== null && (
                <a className="dh-237dddac" href={`/c/${encodeURIComponent(entry.handle)}`} style={{ display: 'inline-flex', alignItems: 'center', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: 600, fontSize: '0.9375rem', lineHeight: 1, border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none' }}>Open page</a>
              )}
              <a href={entry.recordHref} style={{ display: 'inline-flex', alignItems: 'center', padding: '0.7rem 0', fontFamily: MONO, fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)' }}>Verify the record →</a>
            </div>
          </article>
        </Fragment>))}
      </div>
      <p style={{ margin: '2rem 0 0', fontFamily: state === 'listed' ? MONO : "'Geist',sans-serif", fontStyle: state === 'unmeasured' ? 'italic' : 'normal', fontSize: '0.875rem', color: noteColor, maxWidth: '62ch', textWrap: 'pretty' }}>{note}</p>
      <p style={{ margin: '1rem 0 0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', maxWidth: '62ch', textWrap: 'pretty' }}>Running one? <a href="/agents" style={{ color: 'var(--crest,#8be3c6)' }}>How to declare it</a>: the manifest, the sponsored seat and the two statements.</p>
    </div>
  );
}
