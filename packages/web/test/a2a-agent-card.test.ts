// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { agentCardFor } from '@/app/.well-known/agent-card.json/route';
import { servedManifest } from '@/lib/agent-manifest';

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
    const { manifest } = await servedManifest(ORIGIN);
    expect(manifest.mcp.tools.length).toBeGreaterThan(0);
    const card = await agentCardFor(ORIGIN);
    expect(card.skills.length).toBe(manifest.mcp.tools.length);
  });
});
