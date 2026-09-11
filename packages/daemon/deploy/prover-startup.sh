#!/bin/bash
# Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
#
# The zkLogin proving service, reconstructed on every boot.
#
# # Why this machine exists at all
#
# zkLogin needs a Groth16 proof per sign-in. Mysten's public prover serves devnet and testnet only,
# and no managed mainnet prover is available to this deployment — so the proving service is
# self-hosted or the feature is off.
#
# Measured here, so the sizing is not mistaken for something it is not: loading the 588 MB key takes
# 928 ms and leaves the backend idling at ~655 MB. The 16 GB is headroom for *proof generation*, not
# for holding the key — rapidsnark allocates per request. The ceiling itself is still unmeasured
# under real load; what is confirmed is that idle cost is small and the sizing is not about startup.
#
# # The rule for this machine, same as the others
#
# **If it is not in this file, it does not survive a reboot.** Container-Optimized OS rebuilds /etc
# from the image at every boot. Instance metadata is durable; this file is that metadata.
#
# # No secret appears here
#
# The prover holds no key and signs nothing. It takes a JWT and an ephemeral public key and returns
# a proof — the salt never reaches it, and neither does the seed. Worth stating, because it is what
# makes this box a smaller blast radius than the daemon VM.

set -uo pipefail
exec > >(logger -t prover-startup) 2>&1
echo "prover-startup: begin"

ZKEY_DIR=/var/lib/zklogin
ZKEY="$ZKEY_DIR/zkLogin-main.zkey"
ZKEY_SHA256_FILE="$ZKEY_DIR/zkLogin-main.zkey.sha256"

mkdir -p "$ZKEY_DIR" /run/prover

# --- the proving key ----------------------------------------------------------------------------
#
# Uploaded to this machine, never downloaded by it. The first version of this script fetched from a
# guessed ceremony URL, which 404'd — and because the fetch was `curl -f … && mv`, the failure left
# no file at all while the script carried on and started a prover that then crash-looped on a
# missing key. A proving key is also exactly the artefact not to fetch from a URL and trust on
# arrival: it decides which proofs verify.
if [ ! -s "$ZKEY" ]; then
  echo "prover-startup: FATAL no proving key at $ZKEY — upload it before starting"
  exit 1
fi

# An absent digest is reported rather than treated as a pass: "we did not check" and "it matched"
# must not look the same in a log.
if [ -s "$ZKEY_SHA256_FILE" ]; then
  if ! (cd "$ZKEY_DIR" && sha256sum -c "$(basename "$ZKEY_SHA256_FILE")"); then
    echo "prover-startup: FATAL proving key digest mismatch — refusing to start"
    exit 1
  fi
  echo "prover-startup: proving key digest verified"
else
  echo "prover-startup: WARN no digest file; the proving key was not verified"
fi

# --- the two containers -------------------------------------------------------------------------
#
# A user-defined bridge so the frontend can address the backend **by container name**.
docker network create zklogin >/dev/null 2>&1 || true

# `--restart always` on all three. The containers this replaces had no restart policy, and on the
# shared box that meant a crash left a service down until somebody noticed.
run() {
  local name=$1; shift
  docker rm -f "$name" >/dev/null 2>&1 || true
  if ! docker run -d --restart always --network zklogin --name "$name" "$@" >/dev/null; then
    echo "prover-startup: FAILED to start $name"
    return 1
  fi
}

# The backend does the proving and is the memory-hungry half.
#
# `WITNESS_BINARIES` is required alongside `ZKEY`, and omitting it is not a silent default — the
# server prints "Invalid usage" and exits 255, which `--restart always` then renders as a crash
# loop rather than as a configuration error. `/app/binaries` is where the image keeps them, next to
# the 134-byte stub zkey that the real key above replaces.
run zklogin-prover \
  -v "$ZKEY_DIR":/zkey \
  -e ZKEY=/zkey/zkLogin-main.zkey \
  -e WITNESS_BINARIES=/app/binaries \
  -p 127.0.0.1:8081:8080 \
  mysten/zklogin:prover-stable

# The frontend is what clients call; it forwards to the backend. Bound to loopback, never 0.0.0.0 —
# the only route in is the Cloudflare tunnel, which runs on this host and can reach loopback.
#
# The image declares `ENV PORT=8080` and `CMD ["${PORT}"]`. Exec-form CMD is not run through a
# shell, so that is not a variable: the entrypoint receives the literal four characters `${PORT}`
# and runs `node js/service/server.js '${PORT}'`. Node's `listen()` treats a non-numeric string as a
# **UNIX socket path**, so the server binds a file named `${PORT}` and nothing at all listens on TCP
# inside the container.
#
# That failure is invisible from outside. `docker-proxy` still holds the published host port, so
# `ss -lntp` shows 8080 listening and the container shows `Up`; every connection is then reset by a
# server that is running perfectly well on the wrong kind of socket. The log line
# "Server is listening on port ${PORT}" is the only tell.
run zklogin-prover-fe \
  -e PROVER_URI=http://zklogin-prover:8080/input \
  -e NODE_ENV=production \
  -e DEBUG=zkLogin:info,jwks \
  -p 127.0.0.1:8080:8080 \
  mysten/zklogin:prover-fe-stable 8080

# --- the tunnel, last, so what it fronts is already listening -----------------------------------
#
# The connector token is fetched from Secret Manager on every boot and written to `/run`, which is
# tmpfs — so it exists while the machine runs and is gone when it stops. Nothing durable on this
# disk holds a credential, which is the same reason the zkLogin seed lives in Secret Manager rather
# than in a file.
#
# No `gcloud` here: Container-Optimized OS does not ship it. The metadata server mints a token for
# this instance's own service account, which has `secretAccessor` on exactly this one secret.
fetch_tunnel_token() {
  local access secret
  access=$(curl -sf -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
  [ -n "$access" ] || return 1

  secret=$(curl -sf -H "Authorization: Bearer $access" \
    "https://secretmanager.googleapis.com/v1/projects/projectx-daemon-prod/secrets/prover-tunnel-token/versions/latest:access" \
    | sed -n 's/.*"data": *"\([^"]*\)".*/\1/p')
  [ -n "$secret" ] || return 1

  # `printf` rather than `echo`, and no trailing newline inside the value: an env-file line is taken
  # literally, so a stray newline becomes part of the token and the connector fails to register with
  # an error that says nothing about whitespace.
  printf 'TUNNEL_TOKEN=%s\n' "$(printf '%s' "$secret" | base64 -d | tr -d '\r\n')" \
    > /run/prover/tunnel.env
  chmod 600 /run/prover/tunnel.env
}

#
# The connector sits on the same user-defined network as the other two and reaches the frontend by
# container name, so no host networking is involved. The tunnel's ingress is configured remotely
# (`config_src: cloudflare`) and points at `http://zklogin-prover-fe:8080` for that reason — not at
# `127.0.0.1`, which inside this container is the connector itself.
if fetch_tunnel_token && run zklogin-cloudflared --env-file /run/prover/tunnel.env \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run; then
  echo "prover-startup: tunnel connector started"
else
  # Said plainly rather than left to inference. The prover is healthy and completely unreachable,
  # which from outside looks identical to the prover being down.
  echo "prover-startup: FAILED to read the tunnel token — the prover is up but unreachable from outside"
fi

echo "prover-startup: done"
