# Production topology — where weir actually runs

*Ground truth recorded 2026-11-24 by direct inspection of the production host. Replaces
the stale provider history (GCP → DigitalOcean → OVH) that the audit docs carried: the
OVH evacuation moved the estate onto operator-owned hardware, and nothing in-tree
documented that.*

## The estate today

**Two Macs, one tailnet, one tunnel.**

| Machine | Role | Where it sits |
|---|---|---|
| **slvdev** (the "gridframe Mac", user `gridframe`) | The workhorse: runs every self-hosted service | Home LAN behind Cloudflare Tunnel; tailnet `100.80.196.5` |
| **0xda7** (this development Mac) | Development + first custody of keys/secrets | Same tailnet (`100.113.70.36`); SSH to slvdev via `~/.ssh/link-slvdev` |

**slvdev runs** (OrbStack, `docker.expose_ports_to_lan=false`, all publishes loopback-only):

- `xlaunch-proxy` (traefik) — the TLS router every tunnel hostname targets; loopback 80/443/8080
- `gateway-restored`, `weir-mcp-restored`, `weir-edge`, `zklogin-prover{,-fe}` — the weir API/MCP/edge/zklogin tier
- `xlaunch`, `xlaunch-realtime`, `xlaunch-db/redis/sentinel/harness` — the legacy xlaunch app (gridframes.app)
- `synapse-{web,api,postgres,redis,docextract,embed}` — synappse.work
- `vm-registry` — the recovered OVH weir-VM artifacts feeding the restored containers
- Native (launchd, not containers): `com.weir.seal-keyserver` (loopback-only serving, kernel pf-guarded), `cloudflared` (16 hostnames → `https://localhost:443`)

**Edges:** weir.social web = Vercel (deploy.yml, production gate). Everything else =
Cloudflare → cloudflared tunnel on slvdev → traefik. Security-header baseline for all
tunnel hosts: `weir-sec-headers` middleware (traefik dynamic, 2026-11-24).

**Gone:** `walrus.weir.social` (ingress removed 2026-11-24; the publisher path died with
the creator-pays refactor). The OVH VMs (evacuated; only extracted artifacts remain).

## Host → service map (tunnel hosts)

| Host | traefik router | Backend |
|---|---|---|
| api.weir.social | weir-api-machine / weir-api-refuse | gateway-restored:3001 / weir-edge |
| mcp.weir.social | weir-mcp | weir-mcp-restored:8080 |
| seal.weir.social | weir-seal | host loopback :2024 (launchd keyserver) |
| zklogin.weir.social | weir-zklogin | zklogin-prover |
| portal.weir.social | weir-portal | gateway-restored |
| gridframes.app | gf-* | xlaunch (legacy app) |
| synappse.work | syn-* | synapse-web / synapse-api |
| gateway/billing.xlaunch.work | xlaunch.yaml routers | xlaunch tier |

## Change procedure for this topology

- Traefik routing: `slvdev:~/gridframes-server/restore/data/xlaunch/proxy/dynamic/*.yml` (hot-reload; `.bak-*` files are rollback points)
- cloudflared hostnames: `slvdev:~/.cloudflared/config.yml` + `launchctl kickstart -k gui/$(id -u)/com.cloudflare.cloudflared`
- Tunnel-host headers: edit `weir-sec-headers.yml` (same dir), verify with `curl -sSI https://<host>`
- The box never sleeps (`pmset -a sleep 0`); LAN access to keyserver ports is blocked by pf anchor `com.weir/keyserver-guard` (persisted in `/etc/pf.conf`)
- Uptime: `.github/workflows/uptime-alarm.yml` probes all 10 public hosts every 30 min and files a self-closing issue on any deviation

## Known-deliberate states

- OrbStack holds kernel `*:80/*:443/*:2024/*:9184` sockets that SYN-accept but reset non-loopback data — scanner-visible, service-unreachable (gating behavior, verified 2026-11-24)
- `secrets.env.bak-20260913` holds a pre-rotation MASTER_KEY — kept deliberately as recovery material for old sealed ciphertexts
- Open follow-ups tracked in the gridframe-enterprise mission: MASTER_KEY → Keychain (needs GUI session), SOKETI secret rotation, off-disk backups
