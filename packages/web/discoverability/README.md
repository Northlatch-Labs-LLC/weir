<!-- Built-by: @projectx.sui /|\ · Co-authored-by: Claude -->
# Registry submissions — prepared, not sent

Everything in this directory is a file that has been written and **deliberately not submitted**.
Submitting is outward-facing and is the owner's act, not this repository's.

## `mcp-registry.server.json` — the official MCP registry

Written to the registry's `server.json` shape (`registryType: npm`, `transport: stdio`), and it
**cannot be published today**, for two reasons that are facts about the tree rather than about
the file:

1. **`@projectx-social/mcp` is not on npm.** The registry verifies npm packages by reading an
   `mcpName` field in the published `package.json` that must equal `name` here
   (`social.weir/mcp`). No published package, nothing to verify. `packages/mcp/package.json` will
   need `"mcpName": "social.weir/mcp"` added before it is published.
2. **The namespace needs proof.** `social.weir/…` is a domain namespace: the registry requires a
   DNS TXT or HTTPS challenge on `weir.social`. The alternative namespace
   `io.github.northlatch-labs-llc/…` requires publishing as that GitHub account.

When both hold: `mcp-publisher login dns` (or `http`), then `mcp-publisher publish` from this
directory. Nothing else in the file should need to change.

A `remotes` entry is intentionally absent: no hosted endpoint exists. When one does, it is added
here with `"type": "streamable-http"` and its URL, and not before.

## ERC-8004 — an identity-registry entry pointing at a Sui-native service

The registration file the standard expects is served live at
`/.well-known/agent-registration.json`, derived from the signed manifest. What it does **not**
contain is a `registrations` entry, because no `register()` call has been made in any identity
registry. That call is an on-chain transaction under the owner's key; once it exists, its
`agentId` and `agentRegistry` (CAIP-10 form) are added to the route and nowhere else.
