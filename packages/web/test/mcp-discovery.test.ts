// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { discoveryFor } from '@/app/.well-known/mcp.json/route';
import { servedManifest } from '@/lib/agent-manifest';

describe('the MCP discovery document', () => {
  const ORIGIN = 'https://weir.social';

  it('takes every field from the manifest rather than repeating it', async () => {
    const doc = await discoveryFor(ORIGIN);
    const { manifest } = await servedManifest(ORIGIN);
    expect(doc.endpoint).toBe(manifest.mcp.hosted);
    expect(doc.tools).toEqual(manifest.mcp.tools);
    expect(doc.readOnly).toBe(manifest.mcp.mode === 'read-only');
    expect(doc.note.startsWith(manifest.mcp.note)).toBe(true);
    expect(doc.name).toBe(manifest.service);
  });

  it('points a reader at the guide and at the signed manifest', async () => {
    const doc = await discoveryFor(ORIGIN);
    expect(doc.documentation).toBe(`${ORIGIN}/llms.txt`);
    expect(doc.manifest).toBe(`${ORIGIN}/.well-known/weir-agent.json`);
  });

  it('claims no standard it does not have, and says the manifest is the authority', async () => {
    const doc = await discoveryFor(ORIGIN);
    expect(doc.note).toMatch(/no ratified standard/);
    expect(doc.note).toMatch(/signed manifest is the authority/);
  });

  it('says the endpoint holds no key, because that is what the manifest says', async () => {
    const doc = await discoveryFor(ORIGIN);
    expect(doc.note).toMatch(/no signer and no policy/);
    expect(doc.readOnly).toBe(true);
  });

  it('follows the host it was asked on, so a preview deployment does not advertise production', async () => {
    const doc = await discoveryFor('https://preview.example');
    expect(doc.documentation).toBe('https://preview.example/llms.txt');
    expect(doc.manifest).toBe('https://preview.example/.well-known/weir-agent.json');
  });
});

describe('the description says only what the tools can do', () => {
  const ORIGIN = 'https://weir.social';
  it('mentions a balance exactly when weir_balance is listed, and it is not listed on the hosted build', async () => {
    const doc = await discoveryFor(ORIGIN);
    expect(doc.tools).not.toContain('weir_balance');
    expect(doc.description).not.toMatch(/balance/);
    expect(doc.description.includes('check who signed it')).toBe(doc.tools.includes('weir_authorship'));
    expect(doc.description.includes('see the other agents')).toBe(
      doc.tools.includes('weir_agents') || doc.tools.includes('weir_seeking'),
    );
    expect(doc.description).toMatch(/read what a creator published/);
    expect(doc.description).toMatch(/price it from the chain/);
  });

  it('would say balance if the list carried it, so the sentence is derived and not merely edited', async () => {
    const { capabilitiesSentence } = await import('../app/.well-known/mcp.json/route');
    expect(capabilitiesSentence(['weir_search', 'weir_balance'])).toBe('read what a creator published, and check a balance');
    expect(capabilitiesSentence([])).toBe('this endpoint registers no tools');
  });
});
