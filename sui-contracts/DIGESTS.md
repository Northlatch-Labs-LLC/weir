# The two digest files

`ci-expected-digest` — what is **deployed**. The digest the live package on mainnet was built to, with the
compiler pinned in `Published.toml`. CI fails when the source no longer builds to it, so drift is caught on
the pull request and not in an upgrade ceremony.

`ci-next-digest` — what is **intended**, and only present on an upgrade branch. Written by hand, on purpose,
from `sui move build --dump-bytecode-as-base64 --no-tree-shaking` with the pinned compiler, after the
change it describes is reviewed. CI accepts a build that matches either file. The ceremony commit copies
next into expected and deletes next.

## Equal files are refused

If both files exist and hold the **same** value, the guard fails and says so. That state is never
legitimate: it means a ceremony copied next into expected and did not delete next.

The cost of tolerating it is not theoretical. The v5 ceremony on 2026-09-02 promoted the digest and
left `ci-next-digest` behind, and for the next day the guard had a second door standing open — a
deliberately corrupted `ci-expected-digest` passed through the next branch instead of failing.
Found on 2026-09-03 by mutation-testing the guard rather than by reading it. The guard was sound;
the leftover file was the defect, and nothing in the check could tell anyone it was there.

So the last step of a ceremony is enforced rather than remembered.

Why two files rather than editing the first: the first is a fact about the chain and must not change until
the chain does. Editing it on a branch would make CI report the source as deployed when it is not. Before
2026-09-01 the only alternative was leaving every upgrade PR red on this check for its whole life, and a
check that is red by design is a check nobody reads.

The external verifier does NOT know about the second file, and this paragraph used to say it did.

It was true when written: `verification-tools/ci/digest-compare.sh` accepted either file
(protocolx-verify #22, 2026-09-01). That path now exists only under `archive/`. The gate the product
actually ships is `engine/ci/digest-guard.sh`, and it compares against `ci-expected-digest` alone —
checked on 2026-09-03, the string `ci-next-digest` does not appear in it.

The consequence is the failure this whole two-file scheme exists to prevent, reintroduced one layer
out: an upgrade branch whose source builds to *next* rather than *expected* passes our own CI and is
failed by our own external verifier. Recorded here rather than quietly corrected, because a
convention document that describes a tool it no longer matches is how the first version of this
problem survived.

## The `agent_mind` package has its own

`sui-contracts-mind/` is a separate package (`agent_mind`), published on its own and never as an upgrade
of `projectx_social`, so its digest is tracked in its own pair of files under that directory. Today it has
only `ci-next-digest` — the digest of the mind package built with the pinned compiler by the same dump
command, run inside `sui-contracts-mind/` — and no `ci-expected-digest`, because nothing is deployed yet;
the expected file is created by the commit that records the publish. One thing is different from the main
package: the mind depends on `projectx_social`, and the dependency's *published-at* address is part of the
dump, so the mind digest moves whenever `sui-contracts/Published.toml` moves. The value recorded now was
built against v3; the ceremony recomputes it after v4 lands and before the publish, and that recomputed
value is what the publish must match.
