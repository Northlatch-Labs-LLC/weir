#!/usr/bin/env -S npx tsx
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFile } from 'node:fs/promises';
import { createClient, type ProjectXSocialConfig } from '@projectx-social/sdk';
import { loadChainConfig } from '../src/chain.js';
import { askPurse } from '../src/client.js';
import { runPhaseTwo, type SubmitPort } from '../src/beat.js';
import { parseBeatArgs, parseProfile, DEFAULT_AGENT, DEFAULT_PROFILE, type Profile } from '../src/beat-args.js';

function chainSubmit(config: ProjectXSocialConfig): SubmitPort {
  const client = createClient(config);
  return {
    submit: async ({ txBytesB64, signature }) => {
      const result = (await client.executeTransaction({
        transaction: Uint8Array.from(Buffer.from(txBytesB64, 'base64')),
        signatures: [signature],
      })) as { transaction?: { digest?: string }; digest?: string };
      const digest = result.transaction?.digest ?? result.digest;
      if (typeof digest !== 'string' || digest === '') {
        throw new Error(
          'the transaction was submitted and the node returned no digest in any envelope this ' +
            'client knows. Check the chain before retrying — it may well have succeeded.',
        );
      }
      return digest;
    },
  };
}

const parsed = parseBeatArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${DEFAULT_AGENT}-beat: ${parsed.refused.ruleId} — ${parsed.refused.reason}\n`);
  process.exit(1);
}
const args = parsed.value;
const prefix = `${args.agent}-beat`;

const chain = await loadChainConfig(args.chain);
if (!chain.ok) {
  process.stderr.write(`${prefix}: ${chain.refused.ruleId} — ${chain.refused.reason}\n`);
  process.exit(1);
}

let profile: Profile = DEFAULT_PROFILE;
if (args.profileFile !== null) {
  let text: string;
  try {
    text = await readFile(args.profileFile, 'utf8');
  } catch (error) {
    process.stderr.write(`${prefix}: request-malformed — the profile file ${args.profileFile} could not be read: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const parsedProfile = parseProfile(text);
  if (!parsedProfile.ok) {
    process.stderr.write(`${prefix}: ${parsedProfile.refused.ruleId} — ${parsedProfile.refused.reason}\n`);
    process.exit(1);
  }
  profile = parsedProfile.value;
}

const client = createClient(chain.value);
const publish =
  args.apiOrigin === null || args.address === null
    ? {}
    : {
        publish: {
          origin: args.apiOrigin,
          address: args.address,
          profile,
          ports: {
            http: {
              request: async (input: { method: 'GET' | 'POST'; url: string; body?: unknown; headers?: Record<string, string> }) => {
                const response = await fetch(input.url, {
                  method: input.method,
                  headers: { 'content-type': 'application/json', 'user-agent': `${prefix}/2 (${profile.name} host)`, ...(input.headers ?? {}) },
                  ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
                  signal: AbortSignal.timeout(60_000),
                });
                const text = await response.text();
                let json: unknown = null;
                try { json = JSON.parse(text); } catch { json = null; }
                return { status: response.status, json };
              },
            },
            chain: {
              sharedRef: async (objectId: string) => {
                const { object } = await client.core.getObject({ objectId });
                const owner = object.owner as { $kind?: string; Shared?: { initialSharedVersion: string } };
                if (owner.$kind !== 'Shared' || owner.Shared === undefined) throw new Error(`${objectId} is not a shared object`);
                return { objectId, initialSharedVersion: owner.Shared.initialSharedVersion, mutable: true as const };
              },
              ownedRef: async (objectId: string) => {
                const { object } = await client.core.getObject({ objectId });
                return { objectId, version: object.version, digest: object.digest };
              },
            },
            submit: async (signed: { txBytesB64: string; signature: string }) => chainSubmit(chain.value).submit(signed),
          },
        },
      };

const { state, statePath } = await runPhaseTwo({
  runsDir: args.runs,
  stateDir: args.state,
  beatId: args.beatId,
  ask: { ask: (intent) => askPurse({ socketPath: args.socket, intent }) },
  ...(args.dryRun ? {} : { submit: chainSubmit(chain.value) }),
  ...(args.dryRun ? {} : publish),
});

process.stderr.write(
  `${prefix}: ${state.beatId} ${state.outcome}` +
    (state.ruleId === undefined ? '' : ` rule=${state.ruleId}`) +
    (state.digest === undefined ? '' : ` digest=${state.digest}`) +
    (state.submittedDigest === undefined ? '' : ` submitted=${state.submittedDigest}`) +
    (state.postId === undefined ? '' : ` post=${state.postId}`) +
    ` state=${statePath}\n`,
);

process.exit(state.outcome === 'refused' ? 3 : state.outcome === 'error' ? 1 : 0);
