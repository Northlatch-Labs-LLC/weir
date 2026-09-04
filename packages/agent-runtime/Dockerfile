# Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
#
# Multi-stage (Security findings B1 + A9). Stage "fetch" downloads and verifies the PicoClaw
# v0.3.1 Linux binary; the runtime stage is node:22-bookworm-slim, carrying only the verified
# picoclaw binary, bin/, and picoclaw/ — no curl, no perl, no apt in the image that actually runs.
# No gateway is exposed — this image's ENTRYPOINT runs bin/beat.sh, which checks the rules, then
# runs `picoclaw agent -m ...` once and exits.
#
# Both base images pinned by digest, read live 2026-09-04 via `docker buildx imagetools inspect`:
#   debian:bookworm-slim
#     -> docker.io/library/debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171
#   node:22-bookworm-slim
#     -> docker.io/library/node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
#
# The PicoClaw binary's checksum is verified against a literal ARG, not against a checksums file
# fetched at build time from the same origin as the asset (Security finding A10 — the old
# Dockerfile fetched picoclaw_0.3.1_checksums.txt from the same GitHub release as the binary
# itself, which proves nothing against a compromised release). Both values were read once, by
# hand, from
# https://github.com/sipeed/picoclaw/releases/download/v0.3.1/picoclaw_0.3.1_checksums.txt
# on 2026-09-04.

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS fetch

ARG PICOCLAW_VERSION=0.3.1
ARG TARGETARCH
ARG PICOCLAW_SHA256_AMD64=86f0fe84aa55279352edbe13adfca484a03bcf189e2030b25e34628089069c3f
ARG PICOCLAW_SHA256_ARM64=e78ab0de05d000698ff8b32458e71cb3134e52e9eaf540e3323a72e9914de060

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Map Docker's TARGETARCH to PicoClaw's release asset naming (goreleaser: amd64 -> x86_64), and to
# the literal checksum ARG for that arch. No checksums file is fetched at build time.
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) PICOCLAW_ARCH="x86_64"; EXPECTED="$PICOCLAW_SHA256_AMD64" ;; \
        arm64) PICOCLAW_ARCH="arm64"; EXPECTED="$PICOCLAW_SHA256_ARM64" ;; \
        *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    ASSET="picoclaw_Linux_${PICOCLAW_ARCH}.tar.gz"; \
    BASE_URL="https://github.com/sipeed/picoclaw/releases/download/v${PICOCLAW_VERSION}"; \
    curl -fsSL -o "/tmp/${ASSET}" "${BASE_URL}/${ASSET}"; \
    if [ -z "$EXPECTED" ]; then \
        echo "FATAL: no literal checksum ARG set for ${TARGETARCH:-amd64} — refusing to trust an unverifiable download" >&2; \
        exit 1; \
    fi; \
    ACTUAL="$(sha256sum "/tmp/${ASSET}" | awk '{print $1}')"; \
    if [ "$EXPECTED" != "$ACTUAL" ]; then \
        echo "FATAL: checksum mismatch for ${ASSET}: expected ${EXPECTED} (literal ARG), got ${ACTUAL}" >&2; \
        exit 1; \
    fi; \
    echo "checksum verified against literal ARG: ${ASSET} sha256=${ACTUAL}"; \
    tar -xzf "/tmp/${ASSET}" -C /tmp; \
    install -m 0755 /tmp/picoclaw /usr/local/bin/picoclaw; \
    rm -rf /tmp/*

# --- runtime stage: node:22-bookworm-slim, nothing else installed into it ---
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

# Non-root user. No exposed ports — this image never runs `picoclaw gateway`.
RUN useradd --system --create-home --home-dir /app --shell /usr/sbin/nologin weir-agent

COPY --from=fetch /usr/local/bin/picoclaw /usr/local/bin/picoclaw
# The CA bundle the fetch stage installed, so PicoClaw can verify mcp.weir.social over TLS;
# no package manager runs in this stage.
COPY --from=fetch /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
COPY --chown=weir-agent:weir-agent bin/ /app/bin/
COPY --chown=weir-agent:weir-agent picoclaw/ /app/picoclaw/
RUN chmod +x /app/bin/beat.sh
USER weir-agent

ENV PICOCLAW_CONFIG=/app/picoclaw/config.json
ENV PICOCLAW_GATEWAY_HOST=""
ENV PICOCLAW_BIN=/usr/local/bin/picoclaw

# No EXPOSE — this container never listens.
ENTRYPOINT ["bin/beat.sh"]
