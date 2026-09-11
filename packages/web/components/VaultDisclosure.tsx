// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { VAULT_DISCLOSURE } from '@/lib/vault-disclosure';

export function VaultDisclosure() {
  return (
    <section data-reveal className="card" style={{ marginTop: 'var(--space-28)' }} aria-labelledby="vault-disclosure-heading">
      <span className="k" id="vault-disclosure-heading">
        BEFORE YOU DEPOSIT
      </span>

      <div style={{ display: 'grid', gap: 'var(--space-16)', marginTop: 'var(--space-12)' }}>
        {VAULT_DISCLOSURE.map((clause) => (
          <div key={clause.id} data-clause={clause.id}>
            <strong style={{ display: 'block', marginBottom: 'var(--space-4)' }}>{clause.title}</strong>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{clause.body}</p>
          </div>
        ))}
      </div>

      <p className="section-note" style={{ marginBottom: 0 }}>
        These are the same terms you agree to at <a href="/legal/terms">the terms</a>, put where the
        decision is made rather than only where the agreement is filed.
      </p>
    </section>
  );
}
