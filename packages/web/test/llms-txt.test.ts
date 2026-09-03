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
    // Found by content, then compared to the number llms.txt prints, so the failure message names the
    // line that is true rather than the one that used to be. Moved 322 -> 342 on 2026-09-01 when
    // doc blocks above it grew; the citation is a number in prose and this is the only thing that
    // notices it drifting.
    const line = src.findIndex((l) => l.includes('fee_bps_snapshot: platform.fee_bps()')) + 1;
    expect(line).toBeGreaterThan(0);
    expect(llms).toContain(`creator.move:${line}`);

    /*
      The SECOND line, which this test was named for and did not check until 2026-09-03.

      Its absence is why `llms.txt` shipped reading "creator.move:358 and creator.move:358" — the
      same line printed twice, in a sentence promising two references. The test passed the whole
      time because one correct citation satisfied it. A test that checks half of what its own name
      claims is worse than no test: it is a green light over an unchecked thing.

      Found by content, not by counting: `settle` is the only place a stored snapshot is read back
      out for the split, and if that ever stops being true the promise itself has changed.
    */
    const settleAt = src.findIndex((l) => /^fun settle</.test(l.trim()));
    expect(settleAt, 'settle() must exist for the fee promise to mean anything').toBeGreaterThan(-1);
    const readsSnapshot = src.findIndex(
      (l, i) => i > settleAt && l.includes('vault.fee_bps_snapshot'),
    ) + 1;
    expect(readsSnapshot).toBeGreaterThan(settleAt);
    expect(llms).toContain(`creator.move:${readsSnapshot}`);
    expect(
      line === readsSnapshot,
      'the two citations must be two different lines, not one line printed twice',
    ).toBe(false);
  });

  it('pre-empts the line an auditor will read as a contradiction', () => {
    /*
      `accept_current_terms` assigns `vault.fee_bps_snapshot = platform.fee_bps()`, which reads
      exactly like the platform reaching into a vault it promised not to touch. It is gated on a
      CreatorCap, so only the vault's owner can call it — but an agent auditing the contract finds
      the assignment before it finds the guard, and an unexplained contradiction is a reason to
      distrust everything else we said. So the document has to reach that line first.
    */
    const creator = join(process.cwd(), '../../sui-contracts/sources/creator.move');
    const src = readFileSync(creator, 'utf8').split('\n');
    const at = src.findIndex((l) => l.includes('public fun accept_current_terms<T>(')) + 1;
    expect(at, 'accept_current_terms must exist to be explained').toBeGreaterThan(0);
    expect(llms).toContain(`creator.move:${at}`);
    expect(llms).toContain('accept_current_terms');
    expect(llms).toMatch(/CreatorCap/);

    // And the guard must genuinely be there, or the paragraph is a comfortable lie.
    const body = src.slice(at, at + 14).join('\n');
    expect(body).toMatch(/assert_cap\(vault, cap\)/);
  });

  it('says where the contracts it cites actually are', () => {
    /*
      Every citation above is a file and a line number in a repository the reader was never given.
      Four agents were watched going looking for exactly this kind of unaddressed reference; one
      crawled the organisation's private repositories to find it.
    */
    expect(llms).toContain('github.com/Northlatch-Labs-LLC/weir-protocol');
    expect(llms).toContain('sui-contracts');
    expect(llms).toMatch(/BUSL/);
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

/*
  The opening section makes structural promises about the contracts — soulbound accounts, separated
  balances, a covered creation fee. A promise about code, written in prose, in a file the code does
  not import, is exactly the thing that goes quietly false. These read the contract.
*/
describe('the promises in the opening are true of the contract', () => {
  const contract = (name: string) =>
    readFileSync(join(process.cwd(), `../../sui-contracts/sources/${name}`), 'utf8');

  it('the account really is soulbound: key, and no store', () => {
    const src = contract('account.move');
    const decl = src.split('\n').find((l) => l.includes('public struct SocialAccount has'));
    expect(decl, 'SocialAccount must exist').toBeTruthy();
    /*
      `store` is the whole claim. With it the account becomes transferable by anyone holding it and
      every sentence about custody in this document becomes false at once.
    */
    expect(decl).toContain('has key');
    expect(decl, 'adding `store` makes the account transferable and this document wrong').not.toContain('store');
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/SocialAccount has key/);
    expect(prose).toMatch(/lost key is a lost account/i);
  });

  it('creator earnings and platform commission are genuinely two balances', () => {
    const src = contract('creator.move');
    expect(src).toMatch(/earnings: Balance<T>/);
    expect(src).toMatch(/platform_fees: Balance<T>/);
    /* If these ever merge into one balance, the separation we advertise stops existing. */
    expect(llms).toContain('platform_fees');
    expect(llms).toContain('CreatorCap');
    expect(llms).toContain('PlatformCap');
  });

  it('describes the vault-fee sponsorship the route actually implements', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/agents/sponsor/route.ts'), 'utf8');
    /*
      The branch was live and undocumented until 2026-09-03, so readers concluded the fee was
      theirs. This fails if the document describes a branch the route dropped, or the route grows
      one the document does not mention.
    */
    expect(route).toMatch(/action'\] === 'vault'|action"\] === "vault"/);
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/action.{0,4}vault/);
    expect(prose).toMatch(/read from the platform object/);
    /* The fee must be read, never assumed — including assumed zero. */
    expect(route).not.toMatch(/creationFeeMist\s*[=:]\s*['"`]?0['"`]?\s*[,;]/);
  });

  it('states the boundary of the offer as plainly as the offer', () => {
    /*
      The opposite error is as expensive as the first: an agent that assumes everything is covered
      reads its first priced call as a fault and reports us broken.
    */
    /*
      Matched against the text with its line wrapping collapsed. Every sentence in this file is
      hard-wrapped at 100 columns, so a phrase long enough to be worth asserting is usually split
      across two lines and a naive regex reports it missing when it is present.
    */
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/fund yourself/i);
    expect(prose).toMatch(/not a fault to report/i);
  });
});

/*
  The key instruction. This is the one piece of advice on the site that, if wrong, costs the reader
  something it cannot get back — and ours was wrong twice at once until 2026-09-03: it told agents
  to keep the key in an environment variable, and it printed the secret to stdout. Four agents
  followed the first. The second is how one runtime's session folder came to hold 86 private keys
  in plain text.
*/
describe('the key advice does not create the exposure it warns about', () => {
  const script = readFileSync(join(process.cwd(), 'public/register-agent.mjs'), 'utf8');

  it('never prints the secret, only where it was put', () => {
    /*
      Matched on the call rather than on prose. `getSecretKey()` reaching any console call is the
      defect, however the surrounding sentence is worded.
    */
    const printed = script
      .split('\n')
      .filter((l) => /console\.(log|error|info|warn)/.test(l) && /getSecretKey|secretKey/.test(l));
    expect(printed, `these lines print the key: ${printed.join(' | ')}`).toEqual([]);
  });

  it('writes the key with an owner-only mode, and refuses to clobber an existing one', () => {
    expect(script).toMatch(/mode: 0o600/);
    /*
      `wx` rather than a plain write. For a soulbound account, overwriting a key file is not a lost
      file — it is a lost identity, with no way back to the address that held the vault.
    */
    expect(script, 'the write must refuse an existing path, not truncate it').toMatch(/flag: 'wx'/);
    /* And a key already readable by others is reported, not quietly repaired. */
    expect(script).toMatch(/0o077/);
  });

  it('reads the key back before it is used', () => {
    /*
      A key believed saved and not saved is the only unrecoverable outcome in this script: the next
      run generates a different key, a different address, and the first is gone.
    */
    expect(script).toMatch(/did not read back/);
  });

  it('llms.txt teaches the file, not the environment variable', () => {
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/weir-agent\.key/);
    expect(prose).toMatch(/0600/);
    expect(prose).toMatch(/does NOT print the key/i);
    /*
      The old instruction still WORKS — agents registered under it must not be locked out — but the
      document must no longer recommend it.
    */
    expect(prose).toMatch(/environment variable is readable by every other process/);
  });
});

/*
  Claims about what is published. "Not yet published to npm" sat in this file for a day after the
  package went live, telling readers they could not run the spending tools they could in fact
  install with one command.
*/
describe('llms.txt does not understate what is available', () => {
  it('names the MCP package at the version the repository builds', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), '../mcp/package.json'), 'utf8'),
    ) as { name: string; version: string };
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toContain(pkg.name);
    expect(prose, `llms.txt must name the version it ships (${pkg.version})`).toContain(pkg.version);
    expect(prose, 'the package is published; this claim outlived the fact').not.toMatch(
      /not yet published to npm/i,
    );
  });

  it('lists the same hosted tools the signed manifest advertises', () => {
    /*
      Taken from the manifest rather than from packages/mcp, where the names are computed from a
      prefix at registration and appear nowhere as literals. The manifest is the signed document an
      agent verifies against DNS, so it is the right authority for what the hosted server offers —
      and these two files disagreeing means one of them is lying to a reader who checked.
    */
    const manifest = readFileSync(join(process.cwd(), 'lib/agent-manifest.ts'), 'utf8');
    const line = manifest.split('\n').find((l) => /tools: \['weir_/.test(l));
    expect(line, 'the manifest must publish a hosted tool list').toBeTruthy();
    const tools = [...(line ?? '').matchAll(/'(weir_[a-z_]+)'/g)].map((m) => m[1]);
    expect(tools.length).toBeGreaterThan(3);
    for (const t of tools) {
      expect(llms, `llms.txt does not mention the hosted tool ${t}`).toContain(t);
    }
  });
});
