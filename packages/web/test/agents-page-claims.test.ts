// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The agents page describes the MCP server. This holds the description to the server.
//
// A page that lists tools is a mirror of code in another package, and a mirror nobody checks is
// silent when it goes stale. The specific failure this prevents has already happened here once, in
// the other direction: an MCP capability was described publicly before one was reachable. A tool
// renamed or removed in packages/mcp must break this, not quietly make the page wrong.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = join(process.cwd(), 'components/design/Agents.tsx');
const TOOLS = join(process.cwd(), '../mcp/src/tools.ts');

const page = readFileSync(PAGE, 'utf8');

/** Source with comments stripped: a tool named only in prose must not satisfy these. */
const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

describe('the agents page describes the MCP server that exists', () => {
  it('can see the server it describes', () => {
    expect(existsSync(TOOLS), 'packages/mcp/src/tools.ts is gone; the page still describes it').toBe(true);
  });

  it('names every capability the server registers, and invents none', () => {
    const tools = codeOf(readFileSync(TOOLS, 'utf8'));

    // `when('search', ...)` is the single place a capability becomes a registered tool.
    const capabilities = [...tools.matchAll(/when\('([a-z-]+)'/g)].map((m) => m[1]!);
    expect(capabilities.length).toBeGreaterThan(5);

    // The page writes them in registered form: weir_ + verb, with read-preview shown as weir_read.
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

  it('does not claim we host the server, because we do not', () => {
    /*
      The server is stdio and the operator runs it. Saying otherwise would be the same false claim
      that was made about an MCP endpoint before one existed, and it matters more than wording: a
      hosted server would mean the agent's key reaching us, which is the property the page promises
      it does not.
    */
    expect(page).toMatch(/stdio/i);
    expect(page).not.toMatch(/https:\/\/[a-z.]*weir\.social\/(api\/)?mcp/i);
  });

  it('states the cost of soulbound rather than only the benefit', () => {
    // Every claim of a guarantee on this page is paired with what it costs. This is the one that
    // costs the most, and a page that dropped it would be selling rather than describing.
    expect(page).toMatch(/no key rotation/i);
  });

  it('does not claim the ACCOUNT cannot change hands, only that the OBJECT cannot move', () => {
    /*
      Research on TEE-based key encumbrance (Liquefaction, Cornell/IC3) shows the rights a key
      controls can be rented or sold while the key never moves and nothing appears on chain, and it
      names soulbound tokens as what it undermines. A vault with a fixed commission and a real
      earnings stream is exactly the priceable cashflow such a market values. So the page must
      claim the narrower, true thing.
    */
    expect(page).toMatch(/invisible to us|transfer of control/i);
  });

  it('names the upgrade capability beside the no-decryption-key claim', () => {
    /*
      Mysten's own Seal documentation: whoever can upgrade the package can rewrite the policy and
      grant themselves decryption access. "We hold no decryption key" is therefore true and not the
      load-bearing fact — without the second clause it is a policy promise dressed as a
      cryptographic one, and it is the first thing a competent adversarial reader checks.
    */
    expect(page).toMatch(/upgrade the package/i);
    expect(page).toMatch(/multisig/i);
  });

  it('says the absence of rotation is our choice rather than a limit of the chain', () => {
    // zkLogin already gives fixed addresses with rotating keys, and Sui's post-quantum plan adds
    // address aliases. Presenting a design decision as a platform constraint is the kind of thing
    // a reader discovers and then stops believing the rest of the page.
    expect(page).toMatch(/our choice, not a limit of the chain/i);
  });
});
