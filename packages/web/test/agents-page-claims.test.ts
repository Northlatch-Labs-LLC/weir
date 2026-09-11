// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = join(process.cwd(), 'components/design/Agents.tsx');
const TOOLS = join(process.cwd(), '../mcp/src/tools.ts');

const page = readFileSync(PAGE, 'utf8');

const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

describe('the agents page describes the MCP server that exists', () => {
  it('can see the server it describes', () => {
    expect(existsSync(TOOLS), 'packages/mcp/src/tools.ts is gone; the page still describes it').toBe(true);
  });

  it('names every capability the server registers, and invents none', () => {
    const tools = codeOf(readFileSync(TOOLS, 'utf8'));

    const capabilities = [...tools.matchAll(/when\('([a-z-]+)'/g)].map((m) => m[1]!);
    expect(capabilities.length).toBeGreaterThan(5);

    const shown = new Set([...page.matchAll(/weir_([a-z]+)/g)].map((m) => m[1]!));

    for (const cap of capabilities) {
      const verb = cap === 'read-preview' ? 'read' : cap;
      expect(shown.has(verb), `the server registers "${cap}" and the page never mentions weir_${verb}`).toBe(true);
    }
    for (const verb of shown) {
      const known = capabilities.some((c) => (c === 'read-preview' ? 'read' : c) === verb);
      expect(known, `the page advertises weir_${verb} and the server registers no such capability`).toBe(true);
    }
  });

  it('describes the hosted server as read-only and keyless, and still says spending is local', () => {
    expect(page).toMatch(/mcp\.weir\.social/i);
    expect(page).toMatch(/read-only/i);
    expect(page).toMatch(/holds no key|never accepts a key/i);
    expect(page).toMatch(/run the same package on your own machine|run the package/i);
  });

  it('states the cost of soulbound rather than only the benefit', () => {
    expect(page).toMatch(/no key rotation/i);
  });

  it('does not claim the ACCOUNT cannot change hands, only that the OBJECT cannot move', () => {
    expect(page).toMatch(/invisible to us|transfer of control/i);
  });

  it('never claims the account cannot be transferred without saying it is the OBJECT', () => {
    for (const m of page.matchAll(/cannot be transferred[^<.]*/gi)) {
      const sentence = page.slice(Math.max(0, m.index! - 220), m.index! + m[0].length);
      const scoped = /OBJECT/.test(sentence) || /holding an object that cannot/.test(sentence);
      expect(scoped, `unscoped claim: ${m[0].slice(0, 70)}`).toBe(true);
    }
  });

  it('names the upgrade capability beside the no-decryption-key claim', () => {
    expect(page).toMatch(/upgrade the package/i);
    expect(page).toMatch(/multisig/i);
  });

  it('says the absence of rotation is our choice rather than a limit of the chain', () => {
    expect(page).toMatch(/our choice, not a limit of the chain/i);
  });
});

describe('the commands the page tells a reader to paste actually work', () => {
  const SCRIPT = join(process.cwd(), 'public/register-agent.mjs');
  const ROUTE = join(process.cwd(), 'app/api/agents/sponsor/route.ts');

  it('prints the script with every argument the script requires', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const script = readFileSync(SCRIPT, 'utf8');

    const usage = script.match(/usage: node register-agent\.mjs ([^']*)/);
    expect(usage, 'the script must print its own usage').toBeTruthy();
    const args = (usage?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
    expect(args.length).toBeGreaterThan(1);

    const printed = page.match(/node \$\{registerScriptPath[^`]*`\}/);
    expect(printed, 'the page must print a node invocation').toBeTruthy();
    for (const a of args) {
      expect(
        page,
        `the page prints the script without ${a}, which the script exits on`,
      ).toContain(a);
    }
  });

  it('prints a sponsor request body carrying every field the route demands', () => {
    const route = readFileSync(ROUTE, 'utf8');

    expect(route).toMatch(/declaration is required/);
    expect(page, 'the page omits `declaration`, which the route refuses with a 400').toContain(
      '"declaration"',
    );
    for (const field of ['operatorAddress', 'model', 'purpose', 'timestampMs', 'agentSignature']) {
      expect(page, `the printed body omits declaration.${field}`).toContain(field);
    }
  });

  it('mentions the vault-fee sponsorship the route also offers', () => {
    const route = readFileSync(ROUTE, 'utf8');
    const offersVault = /=== 'vault'/.test(route);
    expect(offersVault).toBe(true);
    expect(page, 'the route sponsors vault creation and the page never mentions it').toContain(
      '"action":"vault"',
    );
  });
});
