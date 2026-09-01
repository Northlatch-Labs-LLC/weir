# The two digest files

`ci-expected-digest` — what is **deployed**. The digest the live package on mainnet was built to, with the
compiler pinned in `Published.toml`. CI fails when the source no longer builds to it, so drift is caught on
the pull request and not in an upgrade ceremony.

`ci-next-digest` — what is **intended**, and only present on an upgrade branch. Written by hand, on purpose,
from `sui move build --dump-bytecode-as-base64 --no-tree-shaking` with the pinned compiler, after the
change it describes is reviewed. CI accepts a build that matches either file. The ceremony commit copies
next into expected and deletes next.

Why two files rather than editing the first: the first is a fact about the chain and must not change until
the chain does. Editing it on a branch would make CI report the source as deployed when it is not. Before
2026-09-01 the only alternative was leaving every upgrade PR red on this check for its whole life, and a
check that is red by design is a check nobody reads.

The external verifier (PVS · digest) reads only `ci-expected-digest` today and will stay red on an upgrade
branch until it learns the second file. That is recorded as a follow-up on the verifier, not papered over
here.
