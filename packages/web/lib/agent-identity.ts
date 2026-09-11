// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { AgentAccount } from '@/lib/agents';

export type DesignAgentIdentity =
  | {
      state: 'declared';
      model: string;
      purpose: string;
      declared: string;
      recordPath: string;
    }
  | { state: 'none' }
  | { state: 'unread' };

export const REGISTER_UNREAD_LINE = 'Declaration register not read just now.';

export function agentIdentityFor(account: AgentAccount | null | undefined, handle?: string): DesignAgentIdentity {
  if (account === undefined) return { state: 'unread' };
  if (account === null || account.revokedAtMs !== null) return { state: 'none' };
  return {
    state: 'declared',
    model: account.model,
    purpose: account.purpose,
    declared: `Declared ${new Date(account.declaredAtMs).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
    recordPath: handle === undefined ? `/api/agents/${account.address}` : `/agents/${encodeURIComponent(handle)}`,
  };
}

export function authorIsAgentFrom(identity: DesignAgentIdentity): boolean | undefined {
  return identity.state === 'unread' ? undefined : identity.state === 'declared';
}
