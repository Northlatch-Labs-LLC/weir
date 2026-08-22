# The web application.
#
# # Why this does not use Next's standalone output
#
# It was tried first, and it does not survive pnpm. Standalone works by tracing the files the server
# actually imports and copying those; pnpm's store puts real packages under
# `node_modules/.pnpm/<name>@<version>/` and exposes them to a dependent through symlinks. The
# tracer copies the resolved files but not the symlink, so the image built, booted, and died on
#
#   MODULE_NOT_FOUND /app/node_modules/.pnpm/next@16.3.1_…/node_modules/@swc/helpers
#
# with `@swc/helpers` present in the image the whole time, one directory away, unreachable by the
# path Next's own code resolves.
#
# Three ways out were measured. Forcing a hoisted node_modules broke `tsc` in the same build.
# Declaring `@swc/helpers` as a direct dependency did not help, because Next resolves it from its
# own store directory rather than from the workspace root. Re-creating the symlink in the runtime
# stage works but leaves a build that is one Next release away from needing a second one.
#
# So the image ships the installed workspace and runs `next start`. It is larger — tens of megabytes
# — and it is correct without depending on a tracer's view of a symlink farm. That is the right
# trade for a container that has to boot unattended, and it is what the daemon image already does.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Manifests first, so the dependency layer stays cached until a dependency actually changes. Copying
# the whole tree first makes every source edit re-resolve the lockfile.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/web/package.json packages/web/

# `--ignore-scripts` because the SDK has a `prepare` script that compiles it, and at this layer only
# the manifests exist — there is no source to compile yet. Splitting them is the safer default
# anyway: a build that runs every dependency's lifecycle scripts is a supply-chain surface, and the
# one script actually needed is run explicitly below.
RUN pnpm install --frozen-lockfile --filter @projectx-social/web... --ignore-scripts

COPY packages/sdk packages/sdk
COPY packages/web packages/web
RUN pnpm --filter @projectx-social/sdk build

# The build needs no chain access and no database. Every page is `force-dynamic` precisely so that
# nothing on-chain is baked into HTML at build time and later served as though it were current.
RUN pnpm --filter @projectx-social/web build

# --- runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable

# Never root. A container escape from root is a different conversation from one out of an
# unprivileged user, and this process holds a database credential.
RUN addgroup -S projectx && adduser -S -G projectx projectx

COPY --from=build --chown=projectx:projectx /app /app

# Uploaded media lives outside `public/` deliberately: it is served by a route that checks
# entitlement against chain objects, never by the static handler. A paywalled image under `public/`
# is served by filename to anyone who guesses it, which is how the platform this replaces leaked
# paid content. The volume mounts here at run time; baking it into the image would ship somebody's
# paid media inside a distributable artefact.
RUN mkdir -p /app/media && chown projectx:projectx /app/media

USER projectx
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000

# No ENV for secrets. They arrive at run time. A credential baked into an image is in every layer,
# every registry copy and every `docker history` of it, forever.
CMD ["pnpm", "--filter", "@projectx-social/web", "start"]
