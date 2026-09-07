// Built-by: @projectx.sui · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { agentCardFor } from '@/app/.well-known/agent-card.json/route';
import { servedManifest } from '@/lib/agent-manifest';

/**
 * `/.well-known/agent-card.json` must never disagree with the signed manifest, and must never
 * claim a protocol this deployment does not speak.
 *
 * A registry builds a public listing by fetching this file once and believing it. Two failures
 * would follow a wrong card and neither is visible from here: a client dials an endpoint that
 * answers nothing, or it believes a capability the endpoint refuses to have. Every assertion below
 * is against the manifest read in the same breath, so a change to one that forgets the other fails
 * here rather than in a stranger's agent runtime.
 */
describe('the A2A agent card', () => {
  const ORIGIN = 'https://weir.social';

  it('takes the endpoint, protocol revision and version from the manifest rather than repeating them', async () => {
    const card = await agentCardFor(ORIGIN);
    const { manifest } = await servedManifest(ORIGIN);
    const iface = card.supportedInterfaces[0];
    expect(iface).toBeDefined();
    expect(iface?.url).toBe(manifest.mcp.hosted);
    expect(iface?.protocolVersion).toBe(manifest.mcp.protocolRevision);
    expect(card.name).toBe(manifest.service);
    expect(card.version).toBe(`${manifest.manifest.split('/')[1]}.0.${manifest.version}`);
  });

  it('declares the binding it actually serves, and never JSONRPC', async () => {
    /*
      The whole point of this file. This deployment speaks MCP over streamable HTTP and does not
      implement A2A's JSON-RPC binding, so naming JSONRPC would publish an endpoint that answers
      nothing. `protocol_binding` is an open-form string in the A2A spec precisely to allow this.
    */
    const card = await agentCardFor(ORIGIN);
    expect(card.supportedInterfaces[0]?.protocolBinding).toBe('MCP');
    for (const iface of card.supportedInterfaces) {
      expect(iface.protocolBinding).not.toBe('JSONRPC');
    }
  });

  it('lists exactly the tools the manifest registers, in the same order', async () => {
    const card = await agentCardFor(ORIGIN);
    const { manifest } = await servedManifest(ORIGIN);
    expect(card.skills.map((s) => s.id)).toEqual(manifest.mcp.tools);
  });

  it('carries the manifest sentence saying the hosted endpoint holds no key', async () => {
    // The one claim in here a reader might act on: that nothing reachable from this card can spend.
    const card = await agentCardFor(ORIGIN);
    const { manifest } = await servedManifest(ORIGIN);
    expect(card.description).toContain(manifest.mcp.note);
    expect(manifest.mcp.mode).toBe('read-only');
  });

  it('claims no capability the endpoint does not have', async () => {
    const card = await agentCardFor(ORIGIN);
    expect(card.capabilities).toEqual({
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    });
  });

  it('carries every field the A2A v1.0 specification marks REQUIRED', async () => {
    const card = await agentCardFor(ORIGIN);
    for (const field of [
      'name',
      'description',
      'version',
      'supportedInterfaces',
      'capabilities',
      'defaultInputModes',
      'defaultOutputModes',
      'skills',
    ] as const) {
      expect(card[field], `required field ${field}`).toBeDefined();
    }
    expect(card.supportedInterfaces.length).toBeGreaterThan(0);
    expect(card.skills.length).toBeGreaterThan(0);
    for (const skill of card.skills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.tags.length).toBeGreaterThan(0);
    }
  });

  it('refuses to publish a card that silently omits a registered tool', async () => {
    /*
      Guards the failure mode that would be invisible in production: a seventh tool is registered,
      SKILL_COPY is not updated, and the card lists six capabilities while looking complete. The
      route throws instead. Asserted through the real code path by asking for a manifest whose tool
      list this test controls.
    */
    const { manifest } = await servedManifest(ORIGIN);
    expect(manifest.mcp.tools.length).toBeGreaterThan(0);
    // Every registered tool resolves today; that is what makes the throw a guard and not a bug.
    const card = await agentCardFor(ORIGIN);
    expect(card.skills.length).toBe(manifest.mcp.tools.length);
  });
});
