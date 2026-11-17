# Release notes draft — security-upgrades-2026-11-16

Release candidate for branch `release/security-upgrades-2026-11-16` (head 6a8b1eb after release prep).
Nothing in this file has been executed; every command below is an operator step.

## (a) Proposed tag: `v12.4.0`

The repo has exactly one prior release: tag `v12.3.4`, name "Weir 12.3.4", published 2026-09-25,
body = flat bullets, no headings, no release automation.

The `v12.3.4` number encodes no published package version — the packages shipped from this repo
were already 1.0.x (sdk/policy/signer/agent/daemon 1.0.2, mcp 1.0.4). It does, however, exactly
match the pnpm toolchain pin: `devEngines.packageManager` = pnpm 12.3.4 (`onFail: error`), and the
lockfile's `packageManagerDependencies`. The direction of the coincidence is readable in the
history: UPDATE.md's 2026-09-12 audit entry records the pin ("pnpm 12.3.4 vs 12.4.1") thirteen days
BEFORE the tag — the release was named after the toolchain state, not the other way around.

That scheme has no fresh number to offer today: the pin is still 12.3.4, and re-using it would
collide with the existing immutable release. So the tag number is treated as its own repo-release
sequence, anchored at `v12.3.4` and moved by semver against the content. This release adds
enforcement surfaces and gates (CodeQL, SHA-pinned actions, the CSP second hash + report
collector, the explicit release-age quarantine, three more routes recording failures) and refreshed
dependency minors — additive, nothing breaking. That is a minor, not a patch: `v12.3.5` would
understate the new gates; a major has no justification. **Working proposal: `v12.4.0`.**

Caveat, recorded honestly: with a single prior tag the numbering scheme is inferred, not
established. If the operator prefers a date-based label (`v2026.11.16`), this is the release to
switch in — but continuity with the existing tag and any tooling that assumes it favors `v12.4.0`.

## (b) Release body (flat bullets, v12.3.4 style — paste verbatim into the GitHub release)

Public repository release.

- Security advisory GHSA-mfr8-8qww-v76h (next >= 16.3.0 <= 16.4.4, moderate) cleared: next 16.4.1 → 16.4.6, past the patched boundary (>= 16.4.5)
- Sui stack refreshed: @mysten/sui 2.30.0 → 2.39.1 (7 dependents), @mysten/seal 1.4.10 → 1.5.4 (devDependency in signer, where it answers the custody-compat question), @mysten/dapp-kit-core 1.6.27 → 1.6.43, dapp-kit-react 2.1.29 → 2.1.45, @mysten/suins 2.0.6 → 2.0.20
- Peer ranges repaired in the same step: seal, dapp-kit-core, suins, slush-wallet and wallet-standard peer contexts moved from ^2.31.0 (which pinned 2.30.0 violated, papered over by the lockfile) to ^2.39.1, now resolved exactly; `pnpm peers check` reports zero @mysten complaints. This supersedes the 2026-09-12 refusal of sui 2.31.0 recorded in UPDATE.md, with the reasons written there
- Minor/patch refresh: @modelcontextprotocol/sdk 1.32.0 → 1.32.2, zod 4.6.6 → 4.6.7, pg 8.23.0 → 8.23.1, tsx 4.23.13 → 4.23.15, jose relocked to 6.2.17 under ^6, react/react-dom 19.3.0 → 19.3.1 (^19 peer ranges untouched), tailwindcss relocked to 4.3.5 under ^4, @testing-library/dom 10.4.1 → 10.4.2
- Custody note, seal 1.5: SessionKey no longer rejects a signer whose address differs from the session address (upstream change in seal 1.5.0 — "address alias"). The certificate now names the caller-passed address while the signature still binds the signer's key, so identity binding moved to consumers; both real consumers already bind it by construction (web keys sessions off the signer's address in seal-session.ts, the agent library passes its own address). The custody-compat probe was re-pinned to demonstrate the new contract end-to-end rather than deleted
- CI hardening: all 24 `uses:` refs across the 7 workflows pinned to commit SHAs (each SHA resolved via the GitHub API and cross-verified against `git ls-remote`), CodeQL enabled (public repository, free), dependabot's stale CodeQL comment corrected, `.env.example` gained the 14 operator-side variables the red-team review found implied but never written down
- Web hardening: the three API routes that returned silent 503s on storage failure (agents/mind, agents/seeking, agents/seeking/offers) now record the failure before answering — 61 of 73 routes record, the 12 that do not are routes with no failure path to record; the Report-Only CSP's script-src pins a second hash for the service-worker inline script (both digests asserted by test)
- Release-age quarantine declared explicitly: `minimumReleaseAge: 1440` written in pnpm-workspace.yaml (pnpm 12's default, now a decision someone can audit), with the exemption list moved to the versions this release publishes — and daemon and mcp added to it; both publish from this repository but were missing from the list
- Published packages move in lockstep: @projectx-social/sdk, policy, signer, agent, daemon 1.0.2 → 1.0.3, @projectx-social/mcp 1.0.4 → 1.0.5, every cross-reference between them renumbered to match
- Audit: `pnpm audit` reports 0 known vulnerabilities (baseline this window: 1 moderate)
- Gates: policy 79/79, sdk 299/299, ui 39/39, agent 283/283, purse 239/239, daemon 102/102, room 11/11, mcp chain 148 checks, web 2646 tests (three async-window flakes in one parallel run each proven green in isolation; zero failures attributed to the branch), signer 146/146, workspace-wide typecheck clean, secret scan clean in CI's patterns mode
- Move contracts untouched: sui-contracts 203/203, sui-contracts-mind build + 4/4, and the bytecode digest matches CI's expectation — no chain delta in this window

## (c) Operator publish checklist (exact commands — NOT executed)

```bash
# 0. Precondition: the full gate re-run on the branch head is green (orchestrator step, already planned).

# 1. Push the branch
git push -u origin release/security-upgrades-2026-11-16

# 2. Open the PR
gh pr create --base main --head release/security-upgrades-2026-11-16 \
  --title "Security upgrades: next 16.4.6 for GHSA-mfr8-8qww-v76h, Sui stack refresh, release prep"

# 3. Wait for CI on the PR, then merge (house style: merge commits, "#N merged")
gh pr merge --merge

# 4. Tag the merge commit on main
git checkout main && git pull
git tag -a v12.4.0 -m "Weir 12.4.0"
git push origin v12.4.0

# 5. Write the release body (the bullets from section (b)) to a file
cat > /tmp/weir-12.4.0-body.md <<'EOF'
Public repository release.

- Security advisory GHSA-mfr8-8qww-v76h (next >= 16.3.0 <= 16.4.4, moderate) cleared: next 16.4.1 → 16.4.6, past the patched boundary (>= 16.4.5)
- Sui stack refreshed: @mysten/sui 2.30.0 → 2.39.1 (7 dependents), @mysten/seal 1.4.10 → 1.5.4 (devDependency in signer, where it answers the custody-compat question), @mysten/dapp-kit-core 1.6.27 → 1.6.43, dapp-kit-react 2.1.29 → 2.1.45, @mysten/suins 2.0.6 → 2.0.20
- Peer ranges repaired in the same step: seal, dapp-kit-core, suins, slush-wallet and wallet-standard peer contexts moved from ^2.31.0 (which pinned 2.30.0 violated, papered over by the lockfile) to ^2.39.1, now resolved exactly; `pnpm peers check` reports zero @mysten complaints. This supersedes the 2026-09-12 refusal of sui 2.31.0 recorded in UPDATE.md, with the reasons written there
- Minor/patch refresh: @modelcontextprotocol/sdk 1.32.0 → 1.32.2, zod 4.6.6 → 4.6.7, pg 8.23.0 → 8.23.1, tsx 4.23.13 → 4.23.15, jose relocked to 6.2.17 under ^6, react/react-dom 19.3.0 → 19.3.1 (^19 peer ranges untouched), tailwindcss relocked to 4.3.5 under ^4, @testing-library/dom 10.4.1 → 10.4.2
- Custody note, seal 1.5: SessionKey no longer rejects a signer whose address differs from the session address (upstream change in seal 1.5.0 — "address alias"). The certificate now names the caller-passed address while the signature still binds the signer's key, so identity binding moved to consumers; both real consumers already bind it by construction (web keys sessions off the signer's address in seal-session.ts, the agent library passes its own address). The custody-compat probe was re-pinned to demonstrate the new contract end-to-end rather than deleted
- CI hardening: all 24 `uses:` refs across the 7 workflows pinned to commit SHAs (each SHA resolved via the GitHub API and cross-verified against `git ls-remote`), CodeQL enabled (public repository, free), dependabot's stale CodeQL comment corrected, `.env.example` gained the 14 operator-side variables the red-team review found implied but never written down
- Web hardening: the three API routes that returned silent 503s on storage failure (agents/mind, agents/seeking, agents/seeking/offers) now record the failure before answering — 61 of 73 routes record, the 12 that do not are routes with no failure path to record; the Report-Only CSP's script-src pins a second hash for the service-worker inline script (both digests asserted by test)
- Release-age quarantine declared explicitly: `minimumReleaseAge: 1440` written in pnpm-workspace.yaml (pnpm 12's default, now a decision someone can audit), with the exemption list moved to the versions this release publishes — and daemon and mcp added to it; both publish from this repository but were missing from the list
- Published packages move in lockstep: @projectx-social/sdk, policy, signer, agent, daemon 1.0.2 → 1.0.3, @projectx-social/mcp 1.0.4 → 1.0.5, every cross-reference between them renumbered to match
- Audit: `pnpm audit` reports 0 known vulnerabilities (baseline this window: 1 moderate)
- Gates: policy 79/79, sdk 299/299, ui 39/39, agent 283/283, purse 239/239, daemon 102/102, room 11/11, mcp chain 148 checks, web 2646 tests (three async-window flakes in one parallel run each proven green in isolation; zero failures attributed to the branch), signer 146/146, workspace-wide typecheck clean, secret scan clean in CI's patterns mode
- Move contracts untouched: sui-contracts 203/203, sui-contracts-mind build + 4/4, and the bytecode digest matches CI's expectation — no chain delta in this window
EOF

# 6. Create the GitHub release
gh release create v12.4.0 --title "Weir 12.4.0" --notes-file /tmp/weir-12.4.0-body.md

# 7. npm publish — dependency order, OTP required for every publish.
#    Use pnpm (the repo's devEngines pin makes plain `npm` refuse to run inside the repo);
#    `pnpm publish` runs each package's prepublishOnly (tsc build) and publishes exactly `files`.
#    sdk's dist carries a source-fingerprint stamp (dist/.build-fingerprint, size+mtime based);
#    it rebuilds itself on any test run and version bumps do not disturb it — nothing to do by hand.
. /tmp/weir-gate-env.sh   # PATH-pins pnpm 12.3.4 for nested spawns
cd packages/sdk    && pnpm publish --access public --otp=<6-digit OTP> && cd ../..
cd packages/policy && pnpm publish --access public --otp=<6-digit OTP> && cd ../..
cd packages/signer && pnpm publish --access public --otp=<6-digit OTP> && cd ../..
cd packages/agent  && pnpm publish --access public --otp=<6-digit OTP> && cd ../..
cd packages/daemon && pnpm publish --access public --otp=<6-digit OTP> && cd ../..
cd packages/mcp    && pnpm publish --access public --otp=<6-digit OTP> && cd ../..
#    (order matters: sdk and policy have no workspace deps; signer wants policy+sdk published,
#     agent wants sdk, daemon wants policy+sdk+signer, mcp wants agent+policy+signer)

# 8. Verify each landed — run from a NEUTRAL cwd (/tmp), not the repo (devEngines pin)
npm view @projectx-social/sdk@1.0.3 version
npm view @projectx-social/policy@1.0.3 version
npm view @projectx-social/signer@1.0.3 version
npm view @projectx-social/agent@1.0.3 version
npm view @projectx-social/daemon@1.0.3 version
npm view @projectx-social/mcp@1.0.5 version

# 9. Smoke-install the entry package from the registry in a scratch dir
#    ("published" is not "installable")
cd "$(mktemp -d)" && npm init -y >/dev/null && npm install @projectx-social/mcp@1.0.5
```

## (d) Operator gate list (human-only; the release is blocked on each until done)

1. Push the branch, merge the PR, publish the six npm packages, push the tag, create the GitHub release — the exact commands are section (c).
2. B-04 (daemon heartbeat): set `PROJECTX_DAEMON_HEARTBEAT_URL` (the monitor endpoint) and `DAEMON_EXPECTED=true` in the VM's `harvest-public.env` — the file is regenerated at boot by the heredoc in `packages/daemon/deploy/social-startup.sh` (lines 103-110) and mounted by the `projectx-social-harvest` unit, so the two lines must be added there as well or they vanish on reboot; the daemon reads the URL at `packages/daemon/src/index.ts:103`.
3. B-06 (rate-limit perimeter): set `PROJECTX_SOCIAL_EDGE_SECRET` (checked at `packages/web/lib/rate-limit.ts:53`) and the seven `PROJECTX_SOCIAL_BREAKER_*` quota variables (`packages/web/lib/rate-limit.ts:471-479`, all blank in `.env.example`) as Vercel project environment variables, and add the rate-limit WAF rule in the Cloudflare dashboard.
4. B-07 (CSP enforcement): once `/api/csp-report` (`packages/web/app/api/csp-report/route.ts`) has accumulated enough clean report evidence in `error_events`, promote the header in `packages/web/next.config.ts` from `Content-Security-Policy-Report-Only` to an enforcing `Content-Security-Policy` (folding the script-src with both pinned hashes into the enforced header — today the enforced policy carries only the four break-proof directives), deployed through the normal Vercel path.
5. Also on the operator list from this window: dispose of dependabot PRs #242-#245 — this branch supersedes all four (#242's download-artifact major bump stays a separate, CI-proven PR).

Ledger note: this repository has no CHANGELOG file and none is created for this release — UPDATE.md is the ledger the repo chose, and the history of this window (the supersession of the 2026-09-12 sui refusal, the seal 1.5 SessionKey contract change) is already recorded at the top of it.
