// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * Every file in this workspace that signs a transaction without going through `PolicySigner`.
 *
 * This is a register, not documentation. `test/the-only-path-claim.test.ts` walks the workspace for
 * `signAndExecuteTransaction(` and fails unless what it finds matches this list exactly — so adding
 * a signing path anywhere means declaring it here, and removing one means deleting its entry.
 *
 * What must come through `PolicySigner`: anything holding a capability, spending a budget, or moving
 * another party's funds.
 */
export interface DirectSigningPath {
  /** Repository-relative path. */
  path: string;
  /** Why a spend ceiling would be ceremony rather than a control on this path. */
  why: string;
}

export const DIRECT_SIGNING_PATHS: readonly DirectSigningPath[] = [
  {
    path: 'packages/daemon/src/adapters/signer.ts',
    why:
      'The harvest daemon. Its key is capability-less and gas-only: no AdminCap, no CreatorCap, no '
      + 'treasury authority, and the one call it can make is stake_vault::harvest, which moves a '
      + "vault's own principal into its own stake and can send nothing anywhere else. The control is "
      + 'what that key cannot do; a ceiling on an amount it cannot direct would control nothing.',
  },
  {
    path: 'packages/agent/src/tx.ts',
    why:
      "The agent SDK. It signs with the operator's own key, for the operator, on their own funds. "
      + 'There is no third party whose money a policy would protect — the person bearing the risk is '
      + "the person holding the key. It still simulates before it signs, through the SDK's simulate() "
      + 'gate, which is the property that matters there.',
  },
];
