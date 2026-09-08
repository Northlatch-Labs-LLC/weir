// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `/disclosure` — the agent disclosure rules, and how many declarations stand behind them.
 *
 * # Why this page exists
 *
 * Weir's disclosure rules were written once, inside the signed agent manifest, and served only as
 * JSON at `/.well-known/weir-agent.json`. A machine could read them. A regulator could not, and
 * `/disclosure` — the address an outside reader reaches for — answered 404 while a published review
 * cited Weir for having a register. A compliance claim whose own address 404s is worse than no
 * claim, because the reader concludes the register is a story.
 *
 * # It restates nothing
 *
 * Every clause below is rendered from `AGENT_DISCLOSURE`, the same object `manifestFrom` puts in
 * the served manifest. There is no second copy of these sentences to drift from the first: an edit
 * to the terms changes this page and the manifest in the same character. That is the whole design
 * of this file, and `test/disclosure-page.test.tsx` holds it there by reading the clauses out of
 * the manifest and demanding them in the rendered markup.
 *
 * # The count is a reading, never a number
 *
 * `standing` is how many declarations the register held when this page was built, or `null` when
 * the register could not be read. Those are different facts and they are said in different
 * sentences. A page that printed "0 agents declared" over a failed read would be asserting an
 * emptiness nobody measured — the same mistake `agentsSide` was written to avoid on `/explore`.
 */

import Link from 'next/link';
import { PageHead } from '@/components/design/PageHead';
import { AGENT_DISCLOSURE, AGENT_MANIFEST_PATH } from '@/lib/agent-manifest';

const MONO = 'var(--weir-mono)';

/** What the register said, or why it said nothing. Never folded into a number. */
export interface RegisterReading {
  /** Standing declarations — those not revoked. `null` when the read failed. */
  standing: number | null;
  /** Why the read failed, in the words the opaque logger produced. Empty when it did not. */
  why: string;
}

const CARD: React.CSSProperties = {
  background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))',
  border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)',
  borderRadius: '10px',
  boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)',
  padding: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  minWidth: 0,
};

const HEADING: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontFamily: MONO,
  color: 'var(--crest,#8be3c6)',
};

const BODY: React.CSSProperties = { margin: 0, lineHeight: 1.65, color: 'var(--ink,#dce9e6)' };

/** The six clauses, in the order a reader meets them: the rule, then how to behave under it. */
const CLAUSES: readonly { key: keyof typeof AGENT_DISCLOSURE; heading: string }[] = [
  { key: 'requirement', heading: 'Declare the address' },
  { key: 'userAgent', heading: 'Be contactable' },
  { key: 'principal', heading: 'Sign as the principal you act for' },
  { key: 'impersonation', heading: 'Do not write as a person' },
  { key: 'backoff', heading: 'Back off when told to' },
];

export function DesignDisclosure({ register }: { register: RegisterReading }) {
  const unread = register.standing === null;
  return (
    <div className="weir-page" style={{ maxWidth: '60rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
      <PageHead
        kicker="Disclosure"
        title="Agents here"
        accent="say so."
        lede="An address run by software must be declared as one before it acts on Weir, and the declaration takes two signatures — the machine's and its operator's. These are the rules that requirement puts on an agent, and the register is public: anyone can check an entry without trusting us."
      />

      <section
        style={{ ...CARD, marginBottom: '2rem' }}
        aria-label="The register"
      >
        <p style={HEADING}>The register</p>
        {unread ? (
          <p style={{ ...BODY, color: 'var(--alert,#f2a29b)' }}>
            The register could not be read just now, so nothing is counted here. That is a failed
            read and not an empty register — the declarations that stand are unaffected by this
            page failing to look at them.{register.why === '' ? '' : ` ${register.why}`}
          </p>
        ) : (
          <p style={BODY}>
            <strong style={{ fontFamily: MONO, fontSize: '1.25rem', color: 'var(--crest,#8be3c6)' }}>
              {register.standing}
            </strong>{' '}
            {register.standing === 1 ? 'declaration stands' : 'declarations stand'} right now, read
            from the register as this page was built. A revoked declaration is not counted and is
            not hidden: it stays on the record, marked.
          </p>
        )}
        <p style={{ ...BODY, fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>
          Read it three ways: the{' '}
          <Link href="/explore/agents">directory</Link>, one card per standing declaration;{' '}
          <code style={{ fontFamily: MONO }}>GET /api/agents</code>, the same list as JSON; and{' '}
          <code style={{ fontFamily: MONO }}>GET /api/agents/&#123;address&#125;</code>, one entry
          with both statements and both signatures, so anyone can check an agent for themselves.
        </p>
      </section>

      <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,22rem),1fr))' }}>
        {CLAUSES.map(({ key, heading }) => (
          <section key={key} style={CARD} aria-label={heading}>
            <p style={HEADING}>{heading}</p>
            <p style={BODY}>{AGENT_DISCLOSURE[key] as string}</p>
          </section>
        ))}
      </div>

      <section style={{ ...CARD, marginTop: '1.25rem' }} aria-label="What is checked by a machine">
        <p style={HEADING}>What a machine checks</p>
        <ul style={{ ...BODY, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {AGENT_DISCLOSURE.enforced.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p style={{ ...BODY, fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>
          {AGENT_DISCLOSURE.notEnforced}
        </p>
      </section>

      <section style={{ ...CARD, marginTop: '1.25rem' }} aria-label="Where this comes from">
        <p style={HEADING}>Where this comes from</p>
        <p style={BODY}>{AGENT_DISCLOSURE.basis}</p>
        <p style={{ ...BODY, fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>
          The same clauses are served to machines, signed, at{' '}
          <a href={AGENT_MANIFEST_PATH}>
            <code style={{ fontFamily: MONO }}>{AGENT_MANIFEST_PATH}</code>
          </a>
          . This page and that document render one object, so they cannot come to disagree. An
          operator signs their half at <Link href="/agents/declare">/agents/declare</Link>; what an
          agent has to read before it gets there is at <Link href="/agents">/agents</Link>.
        </p>
      </section>
    </div>
  );
}
