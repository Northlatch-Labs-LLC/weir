#!/usr/bin/env python3
"""Refuse a commit message that carries internal governance detail.

Commit messages are not private the way a gitignored file is. They travel: GitHub renders them,
Vercel shows them as the deployment description, and anyone granted read access later inherits the
whole history at once. Product decisions, who decided what, incident narratives and internal
document references belong in the local documents, not in a message attached to every deploy.

This exists because the instruction was given twice and drifted back both times. A rule that
depends on remembering is not a rule.

    scripts/check-commit-message.py <path-to-message-file>     # used as a commit-msg hook

Exits 1 and prints what to write instead. `git commit --no-verify` still works, deliberately: the
point is to make the leak deliberate rather than accidental.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Internal governance vocabulary. Each entry is (pattern, what to write instead).
#
# Deliberately NOT banned: the word "operator" on its own, and the word "vault". Both are ordinary
# vocabulary in this repository — the harvest daemon has an operator and the contracts have stake
# vaults — and a rule that fires on ordinary work is a rule people learn to skip.
# Only the constructions that attribute a decision are matched.
BANNED: list[tuple[str, str]] = [
    (r"\bD-\d{3}\b", "the change itself, not the decision record it implements"),
    (r"\bDECISIONS\.md\b", "the technical reason, without naming the internal document"),
    (r"\bSTART-HERE(\.md)?\b", "the technical reason, without naming the internal document"),
    (r"\bCLAUDE\.md\b", "the technical reason, without naming the internal document"),
    (r"\bPROJECT-NOTES\.md\b", "the technical reason, without naming the internal document"),
    (r"\bINFRASTRUCTURE\.md\b", "the technical reason, without naming the internal document"),
    (r"\bBACKGROUND-TASKS\.md\b", "the technical reason, without naming the internal document"),
    (r"(?i)\b(at|by|on) the operator'?s? (instruction|decision|request)\b",
     "what changed, without attributing it"),
    (r"(?i)\bby operator decision\b", "what changed, without attributing it"),
    (r"(?i)\bdecided by (you|the operator)\b", "what changed, without attributing it"),
    (r"(?i)\bthe operator (decided|instructed|asked)\b", "what changed, without attributing it"),
    (r"(?i)\bcost (this project|us)\b", "the defect, without the incident history"),
    (r"(?i)\bwhich is why .{0,30}\bwent dark\b", "the defect, without the incident history"),
    (r"(?i)\b(revenue|margin|profit) (path|target|model)\b", "nothing — commercial strategy"),
    (r"(?i)\bbasis points\b|\b\d+\s?bps\b", "nothing — commercial terms"),
]

# Trailers git and tooling add. Never inspected: a Co-Authored-By line is not prose.
TRAILER = re.compile(r"^\s*(Co-Authored-By|Signed-off-by|Change-Id|Reviewed-by|Built-by):", re.I)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check-commit-message.py <message-file>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"could not read the commit message: {exc}", file=sys.stderr)
        return 2

    # A comment line in a commit template is not part of the message.
    lines = [
        ln for ln in raw.splitlines()
        if not ln.lstrip().startswith("#") and not TRAILER.match(ln)
    ]

    findings: list[tuple[int, str, str]] = []
    for i, line in enumerate(lines, start=1):
        for pattern, instead in BANNED:
            match = re.search(pattern, line)
            if match:
                findings.append((i, match.group(0), instead))

    if not findings:
        return 0

    red = "\033[31m"
    dim = "\033[2m"
    off = "\033[0m"
    print(f"{red}commit refused — the message carries internal detail{off}", file=sys.stderr)
    print("", file=sys.stderr)
    for line_no, found, instead in findings:
        print(f"  line {line_no}: {red}{found}{off}", file=sys.stderr)
        print(f"    {dim}write instead: {instead}{off}", file=sys.stderr)
    print("", file=sys.stderr)
    print("  A commit message is shown by GitHub and used as the Vercel deployment", file=sys.stderr)
    print("  description. Say what changed and why it mattered technically.", file=sys.stderr)
    print("", file=sys.stderr)
    print(f"  {dim}--no-verify overrides this, deliberately.{off}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
