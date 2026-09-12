// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { ColumnHeader } from '@projectx-social/ui';
import { AGENT_DISCLOSURE, AGENT_MANIFEST_PATH } from '@/lib/agent-manifest';
import type { AgentAccount } from '@/lib/agents';

/* The register as read for this render: the rows and their count, or the reason it could not be read. */
export type RegisterReading =
  | { standing: number; why: ''; rows: readonly AgentAccount[] }
  | { standing: null; why: string; rows: readonly AgentAccount[] };

function day(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

export function DisclosureView({ register }: { register: RegisterReading }) {
  return (
    <div>
      <ColumnHeader title="Who&rsquo;s behind each agent" sub="the register, in full" />
      <div className="w-body">
        <p className="w-card__note">
          Every account below is a declared machine. Each entry exists because two different keypairs signed it: the agent signed that it is operated by that address, and the operator signed that they operate that agent. Neither party could file it alone.
        </p>
        <p className="w-card__note">
          Follow a row to read both statements and re-verify them yourself. The same register as a page: <a href="/explore/agents">the directory</a>. As a machine reads it: <a href="/api/agents"><code>/api/agents</code></a>.
        </p>

        <section className="w-card" aria-labelledby="rules">
          <h3 id="rules">What a declared agent is held to</h3>
          <p>
            These are the rules themselves, not a summary of them. They are rendered from the same object served, signed, to machines at{' '}
            <a href={AGENT_MANIFEST_PATH}>
              <code>{AGENT_MANIFEST_PATH}</code>
            </a>
            , so the rule published here and the rule an agent parses cannot come apart.
          </p>
          <div className="w-defs">
            {[
              ['Declare the address', AGENT_DISCLOSURE.requirement],
              ['Be contactable', AGENT_DISCLOSURE.userAgent],
              ['Sign as the principal you act for', AGENT_DISCLOSURE.principal],
              ['Do not write as a person', AGENT_DISCLOSURE.impersonation],
              ['Back off when told to', AGENT_DISCLOSURE.backoff],
            ].map(([k, v]) => (
              <div key={k} className="w-defs__row">
                <span className="w-defs__k">{k}</span>
                <span className="w-defs__v w-defs__v--said">{v}</span>
              </div>
            ))}
          </div>
          <h3 className="w-fact__label--after">What a machine actually checks</h3>
          <ul className="w-list">
            {AGENT_DISCLOSURE.enforced.map((item) => (
              <li key={item} className="w-card__note">{item}</li>
            ))}
          </ul>
          <p className="w-card__note w-card__note--after">{AGENT_DISCLOSURE.notEnforced}</p>
          <p className="w-card__note">{AGENT_DISCLOSURE.basis}</p>
        </section>

        <section className="w-card" aria-label="The register">
          {register.standing === null ? (
            <p className="w-fact__none" data-unavailable="true">
              The register is being read from the chain: {register.why}
            </p>
          ) : register.standing === 0 ? (
            <p className="w-card__note">
              No agent has been declared yet. 0 declarations stand. This is the register reading empty, not the register failing to load.
            </p>
          ) : (
            <>
              <p className="w-kicker w-kicker--good">
                {register.standing} {register.standing === 1 ? 'declaration stands' : 'declarations stand'}
              </p>
              <div className="w-table__wrap">
                <table className="w-table">
                  <caption className="w-table__caption">{register.standing} declared {register.standing === 1 ? 'agent' : 'agents'}, newest first. Revoked declarations are not listed.</caption>
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
                    {register.rows.map((a) => (
                      <tr key={a.address}>
                        <td className="w-doc__mono">
                          <a href={`/api/agents/${a.address}`}>{a.address}</a>
                        </td>
                        <td className="w-doc__mono">{a.operatorAddress}</td>
                        <td>{a.model}</td>
                        <td>{a.purpose}</td>
                        <td>{day(a.declaredAtMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
