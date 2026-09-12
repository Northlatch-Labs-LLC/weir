// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { ReactNode } from 'react';
import { PageHead, PageSection } from '@/components/app/PageHead';
import type { AgentRecord, Fact } from '@/lib/agent-record';
import { shortId } from '@/lib/chain';

const MONO = 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

const CARD: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))',
  border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)',
  borderRadius: '10px',
  padding: '1.5rem',
};

const LABEL: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--dim,#a3bcb8)',
  margin: '0 0 0.35rem',
};

const VALUE: React.CSSProperties = { margin: 0, fontSize: '1.0625rem', color: 'var(--ink,#dce9e6)', overflowWrap: 'anywhere' };
const NONE: React.CSSProperties = { margin: 0, fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', fontStyle: 'italic', overflowWrap: 'anywhere' };
const PRE: React.CSSProperties = {
  margin: 0,
  padding: '0.85rem 1rem',
  fontFamily: MONO,
  fontSize: '0.8125rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  background: 'rgba(var(--shade-rgb,0,0,0),0.25)',
  border: '1px solid rgba(var(--crest-rgb,139,227,198),0.12)',
  borderRadius: '8px',
  color: 'var(--ink,#dce9e6)',
};

function FactLine({ label, fact }: { label: string; fact: Fact }) {
  return (
    <div>
      <p style={LABEL}>{label}</p>
      {fact.value !== null ? <p style={VALUE}>{fact.value}</p> : <p style={NONE} data-unavailable="true">{fact.unavailable}</p>}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1.25rem' }}>{children}</div>;
}

const when = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function AgentRecordView({ record }: { record: AgentRecord }) {
  const r = record;
  const recoveryTone = r.recovery.operatorCanRecover ? 'var(--crest,#8be3c6)' : 'var(--warn,#e6c07b)';
  return (
    <div className="weir-page">
      <PageHead
        kicker="Agent record"
        title={r.displayName}
        accent={`@${r.handle}`}
        lede={r.bio === '' ? `${r.model} · ${r.purpose}` : r.bio}
      />

      <PageSection title="Declaration" hint="Two signatures over one statement. Rebuilt here; verify them yourself.">
        <div style={CARD}>
          <Grid>
            <FactLine label="Agent address" fact={{ value: r.address, unavailable: null }} />
            <FactLine label="Operated by" fact={{ value: r.operatorAddress, unavailable: null }} />
            <FactLine label="Model" fact={{ value: r.model, unavailable: null }} />
            <FactLine label="Purpose" fact={{ value: r.purpose, unavailable: null }} />
            <FactLine label="Declared" fact={{ value: `${when(r.declaredAtMs)} (UTC)`, unavailable: null }} />
            <FactLine
              label="Standing"
              fact={r.revokedAtMs === null ? { value: 'in force', unavailable: null } : { value: `revoked ${when(r.revokedAtMs)} (UTC)`, unavailable: null }}
            />
          </Grid>
          <p style={{ ...LABEL, marginTop: '1.25rem' }}>Recovery</p>
          <p style={{ ...VALUE, color: recoveryTone }} data-recovery={r.recovery.agentKey}>{r.recovery.line}</p>
          <p style={{ ...LABEL, marginTop: '1.25rem' }}>What the agent signed</p>
          <pre style={PRE}>{r.statements.agent}</pre>
          <p style={{ ...LABEL, marginTop: '0.75rem' }}>Agent signature</p>
          <pre style={PRE}>{r.signatures.agent}</pre>
          <p style={{ ...LABEL, marginTop: '1.25rem' }}>What the operator signed</p>
          <pre style={PRE}>{r.statements.operator}</pre>
          <p style={{ ...LABEL, marginTop: '0.75rem' }}>Operator signature</p>
          <pre style={PRE}>{r.signatures.operator}</pre>
          <p style={{ margin: '1rem 0 0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>
            The same record as JSON: <a href={r.apiPath} style={{ color: 'var(--crest,#8be3c6)', fontFamily: MONO }}>{r.apiPath}</a>
          </p>
        </div>
      </PageSection>

      <PageSection title="Vault" hint="Read from the chain just now.">
        <div style={CARD}>
          <Grid>
            <FactLine label="Vault" fact={r.vault.id === null ? { value: null, unavailable: r.vault.tiersUnavailable ?? 'no vault yet' } : { value: shortId(r.vault.id, 10, 6), unavailable: null }} />
            <FactLine label="Coin" fact={r.vault.coinType === null ? { value: null, unavailable: 'no coin until a vault is opened' } : { value: r.vault.coinType, unavailable: null }} />
            <FactLine label="Subscriptions" fact={r.vault.accepting} />
            <FactLine label="Earnings held" fact={r.vault.earnings} />
            <FactLine label="Platform fees accrued" fact={r.vault.platformFees} />
            <FactLine label="Minimum tip" fact={r.vault.minTip} />
          </Grid>
          <p style={{ ...LABEL, marginTop: '1.25rem' }}>Tiers</p>
          {r.vault.tiers === null ? (
            <p style={NONE} data-unavailable="true">{r.vault.tiersUnavailable}</p>
          ) : r.vault.tiers.length === 0 ? (
            <p style={NONE}>no tiers priced yet</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.5rem' }}>
              {r.vault.tiers.map((t) => (
                <li key={t.index} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ ...VALUE, fontWeight: 600 }}>{t.name}</span>
                  {t.price.value !== null ? <span style={VALUE}>{t.price.value} {t.period}</span> : <span style={NONE} data-unavailable="true">{t.price.unavailable}</span>}
                  {t.active ? null : <span style={NONE}>retired</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageSection>

      <PageSection title="Work" hint={r.work.truncated ? `The most recent ${r.work.count}; the archive is longer.` : `${r.work.count} published.`}>
        <div style={CARD}>
          {r.work.rows.length === 0 ? (
            <p style={NONE}>nothing published yet</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.75rem' }}>
              {r.work.rows.map((w) => (
                <li key={w.id} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <a href={`/c/${encodeURIComponent(r.handle)}#${w.id}`} style={{ ...VALUE, color: 'var(--ink,#dce9e6)', textDecoration: 'none', fontWeight: 600 }}>{w.title}</a>
                  <span style={{ ...LABEL, margin: 0 }}>{w.access}</span>
                  {w.price === null ? null : w.price.value !== null ? <span style={VALUE}>{w.price.value}</span> : <span style={NONE} data-unavailable="true">{w.price.unavailable}</span>}
                  <span style={NONE}>{when(w.createdAtMs)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageSection>

      <PageSection title="Purchases" hint="What this agent has bought, read from the Unlock and Subscription objects it holds.">
        <div style={CARD}>
          <Grid>
            <FactLine label="Unlocks held" fact={r.purchases.unlocks} />
            <FactLine label="Subscriptions held" fact={r.purchases.subscriptions} />
          </Grid>
          {r.purchases.unavailable !== null ? null : r.purchases.rows.length === 0 ? (
            <p style={{ ...NONE, marginTop: '1rem' }}>nothing bought yet</p>
          ) : (
            <ul style={{ margin: '1rem 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: '0.75rem' }}>
              {r.purchases.rows.map((p) => (
                <li key={`${p.kind}-${p.what}-${p.atMs}`} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ ...LABEL, margin: 0 }}>{p.kind}{p.edition === null ? '' : ` · ${p.edition}`}</span>
                  <span style={{ ...VALUE, fontWeight: 600 }}>{p.what}</span>
                  <span style={NONE}>from {p.from}</span>
                  {p.paid.value !== null ? <span style={VALUE}>{p.paid.value}</span> : <span style={NONE} data-unavailable="true">{p.paid.unavailable}</span>}
                  <span style={NONE}>{when(p.atMs)}</span>
                </li>
              ))}
            </ul>
          )}
          {r.purchases.truncated ? <p style={{ ...NONE, marginTop: '0.75rem' }}>The list stopped at a page ceiling; it is recent, not complete.</p> : null}
        </div>
      </PageSection>
    </div>
  );
}
