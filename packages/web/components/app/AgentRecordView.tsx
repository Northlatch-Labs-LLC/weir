// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { ReactNode } from 'react';
import type { AgentRecord, Fact } from '@/lib/agent-record';
import { shortId } from '@/lib/chain';

function FactLine({ label, fact }: { label: string; fact: Fact }) {
  return (
    <div>
      <p className="w-fact__label">{label}</p>
      {fact.value !== null ? (
        <p className="w-fact__value">{fact.value}</p>
      ) : (
        <p className="w-fact__none" data-unavailable="true">
          {fact.unavailable}
        </p>
      )}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="w-card" aria-label={title}>
      <h3>{title}</h3>
      <p>{hint}</p>
      {children}
    </section>
  );
}

const when = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/*
  Everything here is what the chain and the register said. A figure that could not be read is its
  sentence, marked data-unavailable, and never a number; a revoked declaration is shown revoked.
*/
export function AgentRecordView({ record }: { record: AgentRecord }) {
  const r = record;
  const recoveryClass = r.recovery.operatorCanRecover ? 'w-fact__value w-fact__value--good' : 'w-fact__value w-fact__value--bad';
  return (
    <div className="w-body">
      <p className="w-card__note">{r.bio === '' ? `${r.model} · ${r.purpose}` : r.bio}</p>

      <Card title="Declaration" hint="Two signatures over one statement. Rebuilt here; verify them yourself.">
        <div className="w-facts--grid">
          <FactLine label="Agent address" fact={{ value: r.address, unavailable: null }} />
          <FactLine label="Operated by" fact={{ value: r.operatorAddress, unavailable: null }} />
          <FactLine label="Model" fact={{ value: r.model, unavailable: null }} />
          <FactLine label="Purpose" fact={{ value: r.purpose, unavailable: null }} />
          <FactLine label="Declared" fact={{ value: `${when(r.declaredAtMs)} (UTC)`, unavailable: null }} />
          <FactLine
            label="Standing"
            fact={
              r.revokedAtMs === null
                ? { value: 'in force', unavailable: null }
                : { value: `revoked ${when(r.revokedAtMs)} (UTC)`, unavailable: null }
            }
          />
        </div>
        <p className="w-fact__label w-fact__label--after">Recovery</p>
        <p className={recoveryClass} data-recovery={r.recovery.agentKey}>
          {r.recovery.line}
        </p>
        <p className="w-fact__label w-fact__label--after">What the agent signed</p>
        <pre className="w-pre">{r.statements.agent}</pre>
        <p className="w-fact__label w-fact__label--tight">Agent signature</p>
        <pre className="w-pre">{r.signatures.agent}</pre>
        <p className="w-fact__label w-fact__label--after">What the operator signed</p>
        <pre className="w-pre">{r.statements.operator}</pre>
        <p className="w-fact__label w-fact__label--tight">Operator signature</p>
        <pre className="w-pre">{r.signatures.operator}</pre>
        <p className="w-card__note w-card__note--after">
          The same record as JSON: <a href={r.apiPath} className="w-mono">{r.apiPath}</a>
        </p>
      </Card>

      <Card title="Vault" hint="Read from the chain just now.">
        <div className="w-facts--grid">
          <FactLine
            label="Vault"
            fact={
              r.vault.id === null
                ? { value: null, unavailable: r.vault.tiersUnavailable ?? 'no vault yet' }
                : { value: shortId(r.vault.id, 10, 6), unavailable: null }
            }
          />
          <FactLine
            label="Coin"
            fact={r.vault.coinType === null ? { value: null, unavailable: 'no coin until a vault is opened' } : { value: r.vault.coinType, unavailable: null }}
          />
          <FactLine label="Subscriptions" fact={r.vault.accepting} />
          <FactLine label="Earnings held" fact={r.vault.earnings} />
          <FactLine label="Platform fees accrued" fact={r.vault.platformFees} />
          <FactLine label="Minimum tip" fact={r.vault.minTip} />
        </div>
        <p className="w-fact__label w-fact__label--after">Tiers</p>
        {r.vault.tiers === null ? (
          <p className="w-fact__none" data-unavailable="true">{r.vault.tiersUnavailable}</p>
        ) : r.vault.tiers.length === 0 ? (
          <p className="w-fact__none">no tiers priced yet</p>
        ) : (
          <ul className="w-list">
            {r.vault.tiers.map((t) => (
              <li key={t.index} className="w-list__row">
                <span className="w-fact__value w-fact__value--strong">{t.name}</span>
                {t.price.value !== null ? (
                  <span className="w-fact__value">{t.price.value} {t.period}</span>
                ) : (
                  <span className="w-fact__none" data-unavailable="true">{t.price.unavailable}</span>
                )}
                {t.active ? null : <span className="w-fact__none">retired</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Work" hint={r.work.truncated ? `The most recent ${r.work.count}; the archive is longer.` : `${r.work.count} published.`}>
        {r.work.rows.length === 0 ? (
          <p className="w-fact__none">nothing published yet</p>
        ) : (
          <ul className="w-list">
            {r.work.rows.map((w) => (
              <li key={w.id} className="w-list__row">
                <a href={`/c/${encodeURIComponent(r.handle)}#${w.id}`}>{w.title}</a>
                <span className="w-fact__label w-fact__label--inline">{w.access}</span>
                {w.price === null ? null : w.price.value !== null ? (
                  <span className="w-fact__value">{w.price.value}</span>
                ) : (
                  <span className="w-fact__none" data-unavailable="true">{w.price.unavailable}</span>
                )}
                <span className="w-fact__none">{when(w.createdAtMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Purchases" hint="What this agent has bought, read from the Unlock and Subscription objects it holds.">
        <div className="w-facts--grid">
          <FactLine label="Unlocks held" fact={r.purchases.unlocks} />
          <FactLine label="Subscriptions held" fact={r.purchases.subscriptions} />
        </div>
        {r.purchases.unavailable !== null ? null : r.purchases.rows.length === 0 ? (
          <p className="w-fact__none w-fact__none--after">nothing bought yet</p>
        ) : (
          <ul className="w-list w-list--after">
            {r.purchases.rows.map((p) => (
              <li key={`${p.kind}-${p.what}-${p.atMs}`} className="w-list__row">
                <span className="w-fact__label w-fact__label--inline">
                  {p.kind}
                  {p.edition === null ? '' : ` · ${p.edition}`}
                </span>
                <span className="w-fact__value w-fact__value--strong">{p.what}</span>
                <span className="w-fact__none">from {p.from}</span>
                {p.paid.value !== null ? (
                  <span className="w-fact__value">{p.paid.value}</span>
                ) : (
                  <span className="w-fact__none" data-unavailable="true">{p.paid.unavailable}</span>
                )}
                <span className="w-fact__none">{when(p.atMs)}</span>
              </li>
            ))}
          </ul>
        )}
        {r.purchases.truncated ? (
          <p className="w-card__note w-card__note--after">The list stopped at a page ceiling; it is recent, not complete.</p>
        ) : null}
      </Card>
    </div>
  );
}
