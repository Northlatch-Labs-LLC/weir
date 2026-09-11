// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * The vault's clauses, on the page where somebody decides to deposit.
 *
 * # Why it renders from the module rather than holding its own prose
 *
 * The same clauses have to be able to appear on more than one surface — the vault page, and one
 * day a creator's own page or an email — and prose copied to a second surface is prose that
 * diverges from the first. `lib/vault-disclosure.ts` is the single source; this renders it, and
 * `test/vault-disclosure.test.tsx` pins the rendered text to that module by identity, so a clause
 * cannot be softened here without the test that reads the module noticing.
 *
 * # It is not collapsible, and that is deliberate
 *
 * A disclosure behind a "show more" is a disclosure nobody read, and the magnitude clause is the
 * one fact on the page most likely to change somebody's mind. Five short clauses are cheaper to
 * read than one paragraph that tries to carry all five.
 */

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
