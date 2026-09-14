// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export type SigningPathKind =
  | 'gate'
  | 'custody'
  | 'direct'
  | 'through-gate'
  | 'probe'
  | 'wallet'
  | 'tooling';

export interface DirectSigningPath {
  path: string;
  kind: SigningPathKind;
  why: string;
}

/*
  The register of every non-browser file that can produce a signature, and why it is
  allowed to. One line per kind:

  - gate:         the policy signer itself — simulation, verdict, then the inner key.
  - custody:      the adapters the gate wraps; a key held at zero distance, deciding nothing.
  - direct:       signs with a key this process holds, without the gate in front of it.
  - through-gate: holds a key but hands every signing decision to the gate built around it.
  - probe:        signs a nonce that authorises nothing, to learn whether the gate is armed.
  - wallet:       the reader's own keys, through their wallet or zkLogin; the platform holds none.
  - tooling:      local operator scripts; a key on the operator's machine, shipped nowhere.
*/

export const DIRECT_SIGNING_PATHS: DirectSigningPath[] = [
  { path: 'packages/signer/src/policy-signer.ts', kind: 'gate', why: 'The gate. Every transaction signature that spends a budget or another party\'s funds is produced through here, after simulation and a policy verdict, and the bytes signed are the bytes simulated.' },
  { path: 'packages/signer/src/local.ts', kind: 'custody', why: 'The custody floor: a keypair held at zero distance from the process, asked for a signature by the gate after a verdict. It decides nothing itself, and every caller is a reviewed decision about where a key lives.' },
  { path: 'packages/signer/src/multisig.ts', kind: 'custody', why: 'Multisig custody: it collects m-of-n partial signatures from member signers and returns one signature. A partial authorises nothing alone, and the gate is what asks for the combination.' },
  { path: 'packages/agent/src/tx.ts', kind: 'direct', why: 'The agent\'s write path: it signs with the signer the operator configured, which is the gate whenever a budget is spent, and it builds once so the bytes it simulates are the bytes it submits.' },
  { path: 'packages/agent/src/statements.ts', kind: 'direct', why: 'The operator\'s own key signs the statement that proves a session. It authorises that address to read or write, and it reaches no funds belonging to anyone else.' },
  { path: 'packages/agent/src/index.ts', kind: 'direct', why: 'The mind\'s key signs the agent\'s own statements. It is the agent\'s identity, generated on the operator\'s machine, and the injection point is what a hosted mind would replace.' },
  { path: 'packages/daemon/src/adapters/signer.ts', kind: 'direct', why: 'The daemon\'s harvest path: a capability-less gas key that signs one call, the vault harvest, with nothing else reachable. It is the blind spot the old guard admitted to and could not see.' },
  { path: 'packages/mcp/src/transport.ts', kind: 'probe', why: 'A capability probe. It signs a random nonce that authorises nothing, only to learn whether this deployment is armed; a refusal is a supported state, and the probe builds no transaction.' },
  { path: 'packages/purse/src/purse.ts', kind: 'through-gate', why: 'The purse holds Heron\'s hot key and still signs nothing itself: every intent it is handed is judged and signed by the policy signer it is built around, and a refusal comes back as a value.' },
  { path: 'packages/purse/src/sweep.ts', kind: 'direct', why: 'The sweep signs as the multisig brake member: one raw keypair produces a single partial signature over bytes the caller supplied, and the combined signature is verified over those same bytes before use.' },
  { path: 'packages/purse/bin/birth-vault.ts', kind: 'through-gate', why: 'The vault-birth CLI signs as the operator\'s multisig hot member through the same wrapper the server uses, after a simulation reports the vault would open, and it stops when it would not.' },
  { path: 'packages/web/lib/signer.ts', kind: 'wallet', why: 'The reader\'s own keys, through their wallet or zkLogin. This file is the adapter rather than a key holder, and for wallets it refuses a signature that covers different bytes than the ones simulated and quoted.' },
  { path: 'packages/web/lib/sponsor.ts', kind: 'direct', why: 'The platform\'s sponsor keypair signs gas-only registrations after a simulation reports success. The platform pays the fee and it gains no authority over the account it sponsored.' },
  { path: 'packages/web/lib/seal-session.ts', kind: 'wallet', why: 'The reader\'s signer authorises a Seal session key. The signature covers the session key\'s own personal message and releases only what that address is entitled to read.' },
  { path: 'packages/web/scripts/verify-e2e-messages.ts', kind: 'tooling', why: 'A local verification script. It signs with a keypair read on the operator\'s own machine to exercise the message path, and it ships in no deployment.' },
  { path: 'packages/web/scripts/test-wallet-signer.ts', kind: 'tooling', why: 'A local script that signs with a generated keypair to exercise the wallet adapter. It spends nothing and it is part of no deployment.' },
];
