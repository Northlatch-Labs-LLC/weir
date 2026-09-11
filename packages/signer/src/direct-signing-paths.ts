// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export interface DirectSigningPath {
  path: string;
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
