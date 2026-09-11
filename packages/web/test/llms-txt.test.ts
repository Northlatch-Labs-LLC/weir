// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
    const creator = join(process.cwd(), '../../sui-contracts/sources/creator.move');
    expect(existsSync(creator)).toBe(true);
    const src = readFileSync(creator, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('fee_bps_snapshot: platform.fee_bps()')) + 1;
    expect(line).toBeGreaterThan(0);
    expect(llms).toContain(`creator.move:${line}`);

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
    const creator = join(process.cwd(), '../../sui-contracts/sources/creator.move');
    const src = readFileSync(creator, 'utf8').split('\n');
    const at = src.findIndex((l) => l.includes('public fun accept_current_terms<T>(')) + 1;
    expect(at, 'accept_current_terms must exist to be explained').toBeGreaterThan(0);
    expect(llms).toContain(`creator.move:${at}`);
    expect(llms).toContain('accept_current_terms');
    expect(llms).toMatch(/CreatorCap/);

    const body = src.slice(at, at + 14).join('\n');
    expect(body).toMatch(/assert_cap\(vault, cap\)/);
  });

  it('says where the contracts it cites actually are', () => {
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
    const body = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const posts = body.match(/JSON\.stringify\(([^)]*)\)/g) ?? [];
    for (const p of posts) expect(p).not.toMatch(/secret|privateKey|SUI_PRIVATE_KEY|getSecretKey/i);
    expect(body).not.toMatch(/fetch\([^)]*getSecretKey/);
  });
});

describe('the promises in the opening are true of the contract', () => {
  const contract = (name: string) =>
    readFileSync(join(process.cwd(), `../../sui-contracts/sources/${name}`), 'utf8');

  it('the account really is soulbound: key, and no store', () => {
    const src = contract('account.move');
    const decl = src.split('\n').find((l) => l.includes('public struct SocialAccount has'));
    expect(decl, 'SocialAccount must exist').toBeTruthy();
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
    expect(llms).toContain('platform_fees');
    expect(llms).toContain('CreatorCap');
    expect(llms).toContain('PlatformCap');
  });

  it('describes the vault-fee sponsorship the route actually implements', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/agents/sponsor/route.ts'), 'utf8');
    expect(route).toMatch(/action'\] === 'vault'|action"\] === "vault"/);
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/action.{0,4}vault/);
    expect(prose).toMatch(/read from the platform object/);
    expect(route).not.toMatch(/creationFeeMist\s*[=:]\s*['"`]?0['"`]?\s*[,;]/);
  });

  it('states the boundary of the offer as plainly as the offer', () => {
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/fund yourself/i);
    expect(prose).toMatch(/not a fault to report/i);
  });
});

describe('the key advice does not create the exposure it warns about', () => {
  const script = readFileSync(join(process.cwd(), 'public/register-agent.mjs'), 'utf8');

  it('never prints the secret, only where it was put', () => {
    const printed = script
      .split('\n')
      .filter((l) => /console\.(log|error|info|warn)/.test(l) && /getSecretKey|secretKey/.test(l));
    expect(printed, `these lines print the key: ${printed.join(' | ')}`).toEqual([]);
  });

  it('writes the key with an owner-only mode, and refuses to clobber an existing one', () => {
    expect(script).toMatch(/mode: 0o600/);
    expect(script, 'the write must refuse an existing path, not truncate it').toMatch(/flag: 'wx'/);
    expect(script).toMatch(/0o077/);
  });

  it('reads the key back before it is used', () => {
    expect(script).toMatch(/did not read back/);
  });

  it('llms.txt teaches the file, not the environment variable', () => {
    const prose = llms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/weir-agent\.key/);
    expect(prose).toMatch(/0600/);
    expect(prose).toMatch(/does NOT print the key/i);
    expect(prose).toMatch(/environment variable is readable by every other process/);
  });
});

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
