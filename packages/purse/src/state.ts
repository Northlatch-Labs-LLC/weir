// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type BeatOutcome = 'signed' | 'refused' | 'no-intent' | 'error' | 'published';

export interface BeatState {
  readonly beatId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: BeatOutcome;
  readonly ruleId?: string;
  readonly digest?: string;
  readonly error?: string;
  readonly submittedDigest?: string;
  readonly postId?: string;
  readonly handle?: string;
  readonly named?: boolean;
}

export const STATE_FILE = 'latest.json';

export async function writeState(stateDir: string, state: BeatState): Promise<string> {
  await mkdir(stateDir, { recursive: true });
  const target = join(stateDir, STATE_FILE);
  const temporary = `${target}.writing`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
  await rename(temporary, target);
  return target;
}
