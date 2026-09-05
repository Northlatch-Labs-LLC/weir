#!/usr/bin/env bash
# Builds agent-runtime-src.tgz from the COMMITTED tree only, with `git archive`.
#
# Heron v1's tarball was built with macOS `tar` over the working tree and shipped `.DS_Store`,
# 49 entries of `.git/` internals, and AppleDouble `._*` files folded onto their parents as
# extended attributes — invisible to a listing grep, which is why the rule checker's refusal was
# the only thing that caught it. `git archive HEAD` on a committed tree cannot carry any of that:
# it reads blobs from the object database, not the filesystem, so there is no `.git/`, no
# `.DS_Store`, no xattr to fold. Verified on this laptop: two `git archive` runs of the same
# commit are byte-identical.
#
# Refuses if the working tree under packages/agent-runtime is dirty — an uncommitted tree has no
# sha to name as what shipped (v1's cause #7).
#
# Output, both at the package root:
#   agent-runtime-src.tgz  — the archive, plus one added file, SOURCE_COMMIT, naming the sha
#   agent-runtime-src.sha  — the same sha, alone, as a sidecar for a script to read without
#                            un-tarring anything
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR" && git rev-parse --show-toplevel)"
PATHSPEC="packages/agent-runtime"

cd "$REPO_ROOT"

if [ -n "$(git status --porcelain -- "$PATHSPEC")" ]; then
  echo "make-source-tarball.sh: refused - $PATHSPEC has uncommitted changes; nothing was built" >&2
  git status --porcelain -- "$PATHSPEC" >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
COMMIT_EPOCH="$(git show -s --format=%ct "$SHA")"

OUT_TGZ="$PKG_DIR/agent-runtime-src.tgz"
OUT_SHA="$PKG_DIR/agent-runtime-src.sha"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
TAR_PATH="$WORKDIR/agent-runtime-src.tar"
SOURCE_COMMIT_FILE="$WORKDIR/SOURCE_COMMIT"

git archive --format=tar --output="$TAR_PATH" "$SHA" -- "$PATHSPEC"

# The sha is recorded a second time, inside the tarball itself, so a copy of the file that has
# already left this laptop still carries its own provenance. Added deterministically (fixed
# mtime = the commit's own timestamp, uid/gid 0, mode 0644) so this addition does not by itself
# make two builds of the same commit differ.
printf '%s\n' "$SHA" > "$SOURCE_COMMIT_FILE"
python3 - "$TAR_PATH" "$SOURCE_COMMIT_FILE" "$COMMIT_EPOCH" <<'PY'
import sys
import tarfile

tar_path, source_commit_file, epoch = sys.argv[1], sys.argv[2], int(sys.argv[3])
with tarfile.open(tar_path, "a", format=tarfile.PAX_FORMAT) as tf:
    info = tarfile.TarInfo(name="SOURCE_COMMIT")
    with open(source_commit_file, "rb") as f:
        data = f.read()
    info.size = len(data)
    info.mtime = epoch
    info.mode = 0o644
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    import io
    tf.addfile(info, io.BytesIO(data))
PY

# gzip -n drops the original filename and mtime from the gzip header (both otherwise vary run to
# run), so the .tgz is byte-identical across builds of the same commit, same as the tar beneath it.
gzip -n -9 -c "$TAR_PATH" > "$OUT_TGZ"
printf '%s\n' "$SHA" > "$OUT_SHA"

BYTES="$(wc -c < "$OUT_TGZ" | tr -d ' ')"
echo "make-source-tarball.sh: $SHA ($BYTES bytes) -> $OUT_TGZ"
