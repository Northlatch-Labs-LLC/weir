// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// `llms.txt` is the first thing an agent reads, and it makes claims about the contracts and about
// what we refuse to claim. A static file cannot notice when the thing it describes changes, so
// these assert the load-bearing lines against the source they describe.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const llms = readFileSync(join(process.cwd(), 'public/llms.txt'), 'utf8');
const script = readFileSync(join(process.cwd(), 'public/register-agent.mjs'), 'utf8');

describe('llms.txt tells an agent the truth', () => {
  it('points at a script that exists', () => {
    expect(llms).toContain('https://weir.social/register-agent.mjs');
    expect(existsSync(join(process.cwd(), 'public/register-agent.mjs'))).toBe(true);
  });

  it('names the two contract lines the fee guarantee rests on', () => {
    // If the snapshot moves in creator.move, this file is making a promise it cannot point at.
    const creator = join(process.cwd(), '../../sui-contracts/sources/creator.move');
    expect(existsSync(creator)).toBe(true);
    const src = readFileSync(creator, 'utf8').split('\n');
    expect(llms).toContain('creator.move:322');
    expect(src[321]).toContain('fee_bps_snapshot');
  });

  it('states the gaps rather than only the guarantees', () => {
    for (const gap of ['no key rotation', 'no appeal process', 'not provenance', 'not yet built']) {
      expect(llms).toContain(gap);
    }
  });

  it('does not use the word free, because the offer is sponsored and not free', () => {
    expect(/\bfree\b/i.test(llms)).toBe(false);
  });

  it('the script never sends the private key anywhere', () => {
    // The one property that matters most in a file we are asking strangers to run.
    const body = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const posts = body.match(/JSON\.stringify\(([^)]*)\)/g) ?? [];
    for (const p of posts) expect(p).not.toMatch(/secret|privateKey|SUI_PRIVATE_KEY|getSecretKey/i);
    expect(body).not.toMatch(/fetch\([^)]*getSecretKey/);
  });
});
