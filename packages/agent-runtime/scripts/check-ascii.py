#!/usr/bin/env python3
"""Refuses (non-zero exit) a file that carries any byte above 0x7F.

Replaces the `grep -P '[^\\x00-\\x7F]'` guard that shipped in Heron v1's
deploy-droplet.sh. Verified on this laptop: the system `/usr/bin/grep` on
macOS does not support `-P` (exits 2, "invalid option -- P"), and inside an
`if grep -qP ...; then` that exit is swallowed by the conditional, so the
guard never fired and reported a file holding U+0080 as clean. This script
uses only the Python standard library, reads the file as raw bytes (never a
text decode, which would raise on the same input for the wrong reason), and
runs the same everywhere the interpreter does.

Usage: check-ascii.py <path>
  exit 0  — every byte in the file is <= 0x7F
  exit 1  — the first offending byte is named by its offset and line number
  exit 2  — usage error or the path could not be read
"""
import sys


def first_non_ascii(data: bytes):
    """Returns (offset, byte, line) for the first byte > 0x7F, or None."""
    line = 1
    for offset, byte in enumerate(data):
        if byte == 0x0A:  # '\n' — count completed lines before this byte
            line += 1
            continue
        if byte > 0x7F:
            return offset, byte, line
    return None


def main(argv):
    if len(argv) != 2:
        print(f"check-ascii.py: usage: check-ascii.py <path>", file=sys.stderr)
        return 2
    path = argv[1]
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as exc:
        print(f"check-ascii.py: refused - could not read {path}: {exc}", file=sys.stderr)
        return 2

    found = first_non_ascii(data)
    if found is None:
        return 0

    offset, byte, line = found
    print(
        f"check-ascii.py: refused - byte 0x{byte:02x} at offset {offset} "
        f"(line {line}) in {path}",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
