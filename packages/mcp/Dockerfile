# The hosted, keyless weir-mcp — public, read-only, no secrets anywhere in this image.
#
# Shape: operations/MCP-HOSTING-SHAPE.md. Same construction as packages/daemon/Dockerfile —
# multi-stage, corepack-pinned pnpm, manifests before sources, never root — with one deliberate
# difference: this image must never receive a key. `WEIR_AGENT_KEY` set under `--http` makes the
# server exit 78 before it listens (packages/mcp/src/transport.ts resolveOptions), and nothing here
# declares, copies or mounts one. Every variable this image reads is public: the six chain ids,
# the coin type, the base URL, and the server's own host/port/allow-lists.
#
# Build context is the REPOSITORY ROOT (the workspace), e.g. from the root:
#   docker build -f packages/mcp/Dockerfile -t weir-mcp .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
# Manifests first, so the dependency layer is cached until a dependency actually changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/sdk/package.json    packages/sdk/
COPY packages/agent/package.json  packages/agent/
COPY packages/policy/package.json packages/policy/
COPY packages/signer/package.json packages/signer/
COPY packages/mcp/package.json    packages/mcp/
# `--ignore-scripts`: the SDK's `prepare` compiles it and there is no source at this layer; the one
# build we need runs explicitly below. `--filter .` includes the workspace root, whose
# devDependencies carry `tsx` — this package has no build of its own yet (README "No build") and
# runs from source, so the runner must be present at run time.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @projectx-social/mcp... --filter .
COPY scripts/write-sdk-fingerprint.mjs scripts/
COPY packages/sdk    packages/sdk
COPY packages/agent  packages/agent
COPY packages/policy packages/policy
COPY packages/signer packages/signer
COPY packages/mcp    packages/mcp
RUN pnpm --filter @projectx-social/sdk build

# --- runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && addgroup -S projectx && adduser -S -G projectx projectx
COPY --from=build --chown=projectx:projectx /app /app
USER projectx
# Cloud Run injects PORT; the server reads WEIR_MCP_HTTP_PORT. Both say 8080 so they cannot
# disagree. 0.0.0.0 is said deliberately — the server's default is loopback, and a container that
# listens on loopback is a container nobody can reach.
ENV NODE_ENV=production \
    PORT=8080 \
    WEIR_MCP_HTTP_HOST=0.0.0.0 \
    WEIR_MCP_HTTP_PORT=8080
EXPOSE 8080
# The Host allowlist (the DNS-rebinding control), the base URL and the eight chain variables are
# supplied by the service definition at deploy time, never baked here — see
# packages/mcp/deploy/cloudrun.service.yaml. No secret is ever an ENV in this file.
ENTRYPOINT ["pnpm", "--filter", "@projectx-social/mcp", "exec", "tsx", "src/index.ts", "--http"]
