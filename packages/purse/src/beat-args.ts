// Built-by: @projectx.sui

import { allow, refuse, type Outcome } from './outcome.js';

export interface BeatArgs {
  readonly runs: string;
  readonly state: string;
  readonly socket: string;
  readonly chain: string;
  readonly beatId: string;
  readonly dryRun: boolean;
  readonly apiOrigin: string | null;
  readonly address: string | null;
  readonly agent: string;
  readonly profileFile: string | null;
}

const FLAGS = ['--runs', '--state', '--socket', '--chain', '--beat-id', '--api-origin', '--address', '--agent', '--profile-file'] as const;
const OPTIONAL = new Set<string>(['--api-origin', '--address', '--agent', '--profile-file']);
export const DEFAULT_AGENT = 'heron';
const AGENT_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const DEFAULT_PROFILE = {
  name: 'Heron',
  bio: 'A Northlatch Labs agent. It reads the network, writes what it sees, and prices its own writing; every signature it produces is bounded by a policy under a human operator.',
} as const;
const PROFILE_NAME_MAX = 60;
const PROFILE_BIO_MAX = 280;

export interface Profile {
  readonly name: string;
  readonly bio: string;
}

export function parseProfile(text: string): Outcome<Profile> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse('request-malformed', 'the profile file is not JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse('request-malformed', 'the profile file is not an object.');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'bio,name') return refuse('request-malformed', 'the profile file carries exactly "name" and "bio" and nothing else.');
  const name = record['name'];
  const bio = record['bio'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > PROFILE_NAME_MAX || /[\r\n\u0000-\u001f\u007f]/.test(name)) {
    return refuse('request-malformed', `profile.name is one line of at most ${String(PROFILE_NAME_MAX)} characters.`);
  }
  if (typeof bio !== 'string' || bio.trim() === '' || bio.length > PROFILE_BIO_MAX || /[\r\n\u0000-\u001f\u007f]/.test(bio)) {
    return refuse('request-malformed', `profile.bio is one line of at most ${String(PROFILE_BIO_MAX)} characters.`);
  }
  return allow({ name, bio });
}

export function parseBeatArgs(argv: readonly string[]): Outcome<BeatArgs> {
  const values = new Map<string, string>();
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!FLAGS.includes(flag as (typeof FLAGS)[number])) {
      return refuse(
        'request-malformed',
        `${flag} is not a flag this takes. It takes: ${FLAGS.join(' ')} [--dry-run].`,
      );
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return refuse('request-malformed', `${flag} needs a value.`);
    }
    values.set(flag, value);
    i += 1;
  }

  for (const flag of FLAGS) {
    if (!OPTIONAL.has(flag) && !values.has(flag)) return refuse('request-malformed', `${flag} is required.`);
  }
  const apiOrigin = values.get('--api-origin') ?? null;
  const address = values.get('--address') ?? null;
  if ((apiOrigin === null) !== (address === null)) {
    return refuse('request-malformed', '--api-origin and --address are given together or not at all.');
  }
  if (apiOrigin !== null && !/^https:\/\/[a-z0-9.-]+$/.test(apiOrigin)) return refuse('request-malformed', '--api-origin is an https origin with no path.');
  if (address !== null && !/^0x[0-9a-f]{64}$/.test(address)) return refuse('request-malformed', '--address is a full lower-case Sui address.');
  const agent = values.get('--agent') ?? DEFAULT_AGENT;
  if (!AGENT_NAME.test(agent)) return refuse('request-malformed', '--agent is a name matching ^[a-z][a-z0-9-]{0,31}$.');
  const profileFile = values.get('--profile-file') ?? null;

  return allow({
    runs: values.get('--runs')!,
    state: values.get('--state')!,
    socket: values.get('--socket')!,
    chain: values.get('--chain')!,
    beatId: values.get('--beat-id')!,
    dryRun,
    apiOrigin,
    address,
    agent,
    profileFile,
  });
}
