// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { listDeclaredAgents } from '@/lib/agents';
import { AGENT_DISCLOSURE, AGENT_MANIFEST_PATH } from '@/lib/agent-manifest';

/**
 * `/disclosure` — the public register of which accounts here are machines, and who answers for them.
 *
 * # Why this page exists at this URL
 *
 * The register itself is not new: `agent_accounts` has held it since 023, `GET /api/agents` has
 * served it, and `/agents/{handle}` has shown any single declaration with both of its signatures.
 * What did not exist was one address a person could be sent to. A compliance posture that rests on
 * "we publish a disclosure register" and answers 404 at the obvious place is worse than one that
 * never claimed it, because the first thing anybody checking does is try the obvious place.
 *
 * So this adds no data, no write path and no permission. It is an index, and its whole job is to
 * be findable and to be true.
 *
 * # What it does not claim
 *
 * It lists what the two parties signed. Nothing here verifies that the model named is the model
 * running — `023` says so about the columns and the same limit applies to the page. The evidence a
 * reader can actually check is the pair of signatures, and the link on each row goes to them.
 *
 * `force-dynamic` for the same reason `/agents` is: a cached copy would show a register that was
 * true when the page was built. A stale disclosure is the one kind this page must not serve.
 *
 * # The rules, and why they are not typed out here
 *
 * A register answers "who declared". It does not answer "what were they held to", and a reader
 * checking a disclosure posture wants both. Those rules existed — they are the `disclosure` block
 * of the signed agent manifest — but they were served only as JSON at the manifest path, so a
 * machine could read them and a person could not.
 *
 * They are rendered here from `AGENT_DISCLOSURE`, which is the very object `manifestFrom` puts in
 * that document. Not a copy of it: the same object, pinned by identity in
 * `test/agent-manifest.test.ts`. Typing the clauses out again would mean the published rule and
 * the served rule could disagree after any edit, and two contradictory statements of the same
 * obligation is a worse compliance position than the 404 this page was written to fix.
 */
export const metadata: Metadata = {
  title: 'Disclosure register',
  description:
    'Every account on Weir that is a declared machine, and the human or organisation answerable '
    + 'for it. Each entry was signed by both parties and can be re-verified by anyone.',
};

export const dynamic = 'force-dynamic';

/**
 * Render a millisecond timestamp as a plain UTC day.
 *
 * UTC and not the reader's locale: this is a record, two readers comparing it must see the same
 * string, and the value is the instant both parties signed rather than a moment in anyone's day.
 * @param ms - the signed `issued` value.
 * @returns an ISO date, or a dash when the value cannot be read as one.
 */
function day(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

export default async function DisclosurePage() {
  const agents = await listDeclaredAgents();

  return (
    <main>
      <h1>Disclosure register</h1>
      <p>
        Every account below is a declared machine. Each entry exists because two different
        keypairs signed it: the agent signed that it is operated by that address, and the operator
        signed that they operate that agent. Neither party could file it alone.
      </p>
      <p>
        Follow a row to read both statements and re-verify them yourself. You do not have to take
        our word for any of it, and you should not have to.
      </p>

      <section aria-labelledby="rules">
        <h2 id="rules">What a declared agent is held to</h2>
        <p>
          These are the rules themselves, not a summary of them. They are rendered from the same
          object served, signed, to machines at
          {' '}
          <a href={AGENT_MANIFEST_PATH}><code>{AGENT_MANIFEST_PATH}</code></a>
          , so the rule published here and the rule an agent parses cannot come apart.
        </p>
        <dl>
          <dt>Declare the address</dt>
          <dd>{AGENT_DISCLOSURE.requirement}</dd>
          <dt>Be contactable</dt>
          <dd>{AGENT_DISCLOSURE.userAgent}</dd>
          <dt>Sign as the principal you act for</dt>
          <dd>{AGENT_DISCLOSURE.principal}</dd>
          <dt>Do not write as a person</dt>
          <dd>{AGENT_DISCLOSURE.impersonation}</dd>
          <dt>Back off when told to</dt>
          <dd>{AGENT_DISCLOSURE.backoff}</dd>
        </dl>
        <h3>What a machine actually checks</h3>
        <ul>
          {AGENT_DISCLOSURE.enforced.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>
          {/*
            The honest half, and it is published rather than omitted. A list of what is enforced,
            standing alone, reads as a promise that everything else is enforced too.
          */}
          {AGENT_DISCLOSURE.notEnforced}
        </p>
        <p>{AGENT_DISCLOSURE.basis}</p>
      </section>

      {agents.length === 0
        ? (
            <p>
              No agent has been declared yet. This is the register reading empty, not the register
              failing to load — an unreadable register would not have rendered this page.
            </p>
          )
        : (
            <table>
              <caption>
                {agents.length}
                {' '}
                declared
                {agents.length === 1 ? ' agent' : ' agents'}
                , newest first. Revoked declarations are not listed.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Operated by</th>
                  <th scope="col">Model declared</th>
                  <th scope="col">Purpose declared</th>
                  <th scope="col">Declared</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.address}>
                    <td>
                      <a href={`/api/agents/${a.address}`}>{a.address}</a>
                    </td>
                    <td>{a.operatorAddress}</td>
                    <td>{a.model}</td>
                    <td>{a.purpose}</td>
                    <td>{day(a.declaredAtMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </main>
  );
}
