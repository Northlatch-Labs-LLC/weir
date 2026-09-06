# Wren's host

Derived from `packages/agent-runtime/digitalocean/` (Heron's) at weir main `bfc070e`, with the name
replaced. Read that directory's README for the reasoning behind every line; it is Heron's history
and it is the reason this recipe is shaped as it is.

As on Heron's host, the firewall is created first, by tag, and the droplet is born inside it.

What is different for Wren, and only this:

- `deploy-droplet.sh` builds the image from the shared runtime package (`packages/agent-runtime`,
  shipped as its own tarball with its own sha256) with **this package's `workspace/`** laid over it
  on the host, verified by a second sha256, before `docker build`.
- The units and policy documents ship from this package (`../systemd`, `../policy`); the purse
  process and phase two are still bundled from `packages/purse`, and started with `--agent wren`.
- The one sealed-credential directory is `/etc/wren/creds`: `openrouter`, `wren-hot`, `wren-ledger`,
  `mail-key`.
- `--install-purse` refuses until `policy/wren-values.json` carries `WREN_VAULT_ID`: Wren's vault is
  born before her purse runs, so her purse starts with statements on and no pre-soul phase.
- `--install-beat` also ships `profile.json`, the name and bio phase two publishes under.

The alert sender is the same gate it is for Heron: notices go out as `Wren <wren@projectxprotocol.dev>`
to the desk's mailbox, because `projectxprotocol.dev` is the one Resend sending domain verified on
record and `weir.social` is not. The sending domain has to be verified and a send-only key sealed
on the host as `mail-key` **before the first alert** can be trusted, which is why `--smoke` sends a
real message and reads its id back from the journal before it enables a single timer.
