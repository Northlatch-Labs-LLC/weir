# Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
#
# Heron v2 image. Multi-stage, one pinned base for both stages so one CVE feed covers the image
# and the Debian 13 host it runs on (CTO spec 2026-09-05-engineering-heron-v2-runtime-and-host.md
# §2.1). Stage "fetch" downloads and verifies the PicoClaw v0.3.1 Linux binary against a literal
# checksum ARG (never a checksums file fetched from the same release it is meant to verify — v1's
# Security finding A10, carried forward); the runtime stage carries only the verified picoclaw
# binary, the CA bundle, bin/ and picoclaw/. No curl and no package manager invocation in either
# stage: the download is node's own fetch (docker/fetch-picoclaw.mjs). Honest disclosure (nothing here claims a stripped image): node:22-trixie-slim is
# a Debian slim image, so dpkg and apt are present on disk in the runtime stage the same as they
# are in the fetch stage — this Dockerfile never runs apt in the runtime stage, but does not and
# cannot remove what the base image ships.
#
# No EXPOSE, no HEALTHCHECK. This container never listens and no process runs between beats — a
# healthcheck would be exactly the always-on process that rule 8 (bin/check-rules.mjs) exists to
# forbid; liveness is the state sink (state/latest.json), not a probe.
#
# The base image is pinned by digest, read live from the registry (Docker Hub does not support
# `docker buildx imagetools inspect` without a running daemon, and Docker stays down on this
# laptop by the Master's order; read instead via the registry HTTP API — an anonymous pull token
# for repository:library/node:pull, then GET the manifest list and take the
# Docker-Content-Digest response header):
#
#   node:22-trixie-slim
#     -> docker.io/library/node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284
#     read 2026-09-05, recorded in picoclaw.provenance.json alongside this file; a base bump and
#     its digest land in the same commit, and test/image.test.mjs asserts the two never drift
#     apart from each other.
#
# The PicoClaw binary's checksum is verified against a literal ARG, read once, by hand, from
# https://github.com/sipeed/picoclaw/releases/download/v0.3.1/picoclaw_0.3.1_checksums.txt
# on 2026-09-05, and also recorded in picoclaw.provenance.json.
#
# The user is `heron`, uid 10001, gid 10001, fixed — never a dynamically allocated system uid.
# v1 collided at uid 999 with DigitalOcean's own `do-agent` on the host (see the CTO spec §1 #3);
# 10001 is chosen because it sits above the entire range Debian's own tooling allocates from
# (Debian Policy §9.2.2: 0 root, 1-99 static, 100-999 dynamic system, 1000-59999 dynamic login,
# 60000-64999 on demand, 65534 nobody) — reasoned from policy, not verified on a Debian host from
# this laptop, and therefore also asserted empirically below: the build refuses if uid or gid
# 10001 already exist before `heron` is created, and refuses again if the id does not resolve to
# `heron` afterward.

ARG NODE_BASE_DIGEST=sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284

FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS fetch

ARG PICOCLAW_VERSION=0.3.1
ARG TARGETARCH
ARG PICOCLAW_SHA256_AMD64=86f0fe84aa55279352edbe13adfca484a03bcf189e2030b25e34628089069c3f
ARG PICOCLAW_SHA256_ARM64=e78ab0de05d000698ff8b32458e71cb3134e52e9eaf540e3323a72e9914de060

# No apt in either stage. The pinned base ships node, tar and sha256sum but neither curl nor a CA
# bundle (its registry layers were listed on 2026-09-05), and the host's cloud firewall permits
# outbound tcp/443 only, so apt over port 80 cannot reach a mirror (the fifth and sixth real
# deploys timed out there). The download is done by node's own fetch, which verifies TLS with the
# Mozilla roots bundled into node; the CA bundle for PicoClaw at runtime is written from those
# same roots, so the image trusts exactly one root set, node's, in both stages.
COPY docker/fetch-picoclaw.mjs /tmp/fetch-picoclaw.mjs
RUN set -eux; \
    mkdir -p /etc/ssl/certs; \
    node -e "process.stdout.write(require('node:tls').rootCertificates.join('\\n') + '\\n')" > /etc/ssl/certs/ca-certificates.crt; \
    chmod 0644 /etc/ssl/certs/ca-certificates.crt; \
    test "$(grep -c 'BEGIN CERTIFICATE' /etc/ssl/certs/ca-certificates.crt)" -gt 100

# Map Docker's TARGETARCH to PicoClaw's release asset naming (goreleaser: amd64 -> x86_64), and to
# the literal checksum ARG for that arch. No checksums file is fetched at build time — the whole
# point of a literal ARG is that a compromised release cannot supply its own proof.
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) PICOCLAW_ARCH="x86_64"; EXPECTED="$PICOCLAW_SHA256_AMD64" ;; \
        arm64) PICOCLAW_ARCH="arm64"; EXPECTED="$PICOCLAW_SHA256_ARM64" ;; \
        *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    ASSET="picoclaw_Linux_${PICOCLAW_ARCH}.tar.gz"; \
    BASE_URL="https://github.com/sipeed/picoclaw/releases/download/v${PICOCLAW_VERSION}"; \
    if [ -z "$EXPECTED" ]; then \
        echo "FATAL: no literal checksum ARG set for ${TARGETARCH:-amd64} — refusing to trust an unverifiable download" >&2; \
        exit 1; \
    fi; \
    node /tmp/fetch-picoclaw.mjs "${BASE_URL}/${ASSET}" "$EXPECTED" "/tmp/${ASSET}"; \
    ACTUAL="$(sha256sum "/tmp/${ASSET}" | awk '{print $1}')"; \
    [ "$EXPECTED" = "$ACTUAL" ] || { echo "FATAL: sha256sum disagrees with the node verifier: ${ACTUAL}" >&2; exit 1; }; \
    tar -xzf "/tmp/${ASSET}" -C /tmp; \
    install -m 0755 /tmp/picoclaw /usr/local/bin/picoclaw; \
    rm -rf /tmp/*

# --- runtime stage: same pinned base as "fetch", nothing else installed into it ---
FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS runtime

# uid 10001 / gid 10001, fixed, never dynamically allocated. Empirically asserted both sides of
# creation (Debian Policy §9.2.2 reasoning is not verified from this laptop — see the header
# comment) so a future base-image bump that happens to pre-allocate 10001 fails the build loudly
# instead of silently colliding, the way v1's uid 999 did against `do-agent`.
RUN set -eux; \
    if getent passwd 10001 >/dev/null 2>&1; then \
        echo "FATAL: uid 10001 already exists before heron is created — refusing to shadow it" >&2; \
        exit 1; \
    fi; \
    if getent group 10001 >/dev/null 2>&1; then \
        echo "FATAL: gid 10001 already exists before heron is created — refusing to shadow it" >&2; \
        exit 1; \
    fi; \
    echo "uid/gid 10001 confirmed empty before heron is created"; \
    groupadd --gid 10001 heron; \
    useradd --uid 10001 --gid 10001 --system --no-create-home --home-dir /app --shell /usr/sbin/nologin heron; \
    RESOLVED_USER="$(getent passwd 10001 | cut -d: -f1)"; \
    RESOLVED_GROUP="$(getent group 10001 | cut -d: -f1)"; \
    if [ "$RESOLVED_USER" != "heron" ] || [ "$RESOLVED_GROUP" != "heron" ]; then \
        echo "FATAL: uid/gid 10001 resolved to '$RESOLVED_USER:$RESOLVED_GROUP', not heron:heron" >&2; \
        exit 1; \
    fi; \
    echo "uid/gid 10001 confirmed to be heron:heron after creation"

COPY --from=fetch /usr/local/bin/picoclaw /usr/local/bin/picoclaw
# The CA bundle the fetch stage wrote from node's bundled Mozilla roots, so PicoClaw can verify
# mcp.weir.social over TLS; no package manager runs in either stage.
COPY --from=fetch /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
COPY --chown=heron:heron bin/ /app/bin/
COPY --chown=heron:heron picoclaw/ /app/picoclaw/
RUN chmod +x /app/bin/beat.sh \
    && chown heron:heron /app

USER 10001:10001

ENV PICOCLAW_CONFIG=/app/picoclaw/config.json
ENV PICOCLAW_GATEWAY_HOST=""
ENV PICOCLAW_BIN=/usr/local/bin/picoclaw

# No EXPOSE — this container never listens. No HEALTHCHECK — no process runs between beats.
ENTRYPOINT ["bin/beat.sh"]
