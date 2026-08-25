#!/usr/bin/env python3
"""Refuse a commit that would publish a credential.

Run standalone, or as `.git/hooks/pre-commit` via `core.hooksPath`. Exits non-zero if anything
is found.

    python3 scripts/scan-secrets.py              what is staged right now (the pre-commit gate)
    python3 scripts/scan-secrets.py --all        every tracked file (the pre-push / audit gate)
    python3 scripts/scan-secrets.py --paths a b  named files, for a mutation test

**Never prints a secret.** A finding is identified by a truncated SHA-256, so two findings can be
told apart and matched against a source without the value reaching a terminal, a log, a CI
transcript or a screen recording. There is no `--show` flag and there must never be one: a masking
regex that assumed a format has already leaked a token on this estate, and a prefix of a private
key is still a prefix of a private key (`packages/daemon/src/config.ts` says the same thing about
`assertSignerConfigured`, for the same reason).

Three independent checks, because no one of them is sufficient:

  1. Path     — a file whose NAME says it holds key material must never be staged at all.
  2. Shape    — regexes for credentials that look like credentials wherever they appear.
  3. Identity — exact containment of values read from this checkout's live `.env` and key files.
                This is the one that matters: it catches a real key pasted into a comment, a
                README, or a test.

# Precision is the whole point

A scanner that cries wolf gets `--no-verify` and then it protects nothing. Every rule below is
either anchored to a credential-specific prefix, or anchored to a variable NAME that marks the
value secret. There is deliberately NO general entropy rule and no "64 hex characters" rule: in
this repository a 64-character hex string is overwhelmingly a Sui object id or a digest, both of
which are public on-chain facts that BELONG in source. `.env.example` is committed here precisely
because those ids are public.

Known non-findings, each checked against this tree before the rule was written:

  - `pnpm-lock.yaml` carries base64 integrity hashes, at least one of which begins `eyJ`. The JWT
    rule therefore requires all three dot-separated segments, which a hash does not have.
  - `.github/workflows/ci.yml` sets `PROJECTX_DATABASE_URL` to a Postgres URL with the password
    `ci` against `localhost`. A credential that only exists inside a job's own service container
    is not a transferable one, so URL rules skip local hosts.
  - `docker-compose.yml` writes `${POSTGRES_PASSWORD}`. An interpolated value is a reference, not
    a secret.
  - `.env.example`, `packages/daemon/.env.example` and `packages/sdk/.env.example` are COMMITTED
    BY DESIGN and CI copies the root one to `packages/web/.env.local`. They are exempt from the
    "no .env-shaped file may be staged" rule and subjected to a stricter one instead: every
    secret-named variable in them must be EMPTY.

# Suppressing a finding

Add `"<path>:<label>:<digest>": "<reason>"` to `scripts/secret-allowlist.json`. A suppression with
an empty reason is refused by this script — waiving the gate is a visible, reviewable act.

**A live credential is never allowlisted.** The remedy for a committed key is rotation at the
provider followed by removal; recording its digest here would turn the one gate that noticed into
the reason nobody notices again.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

# ── the tree ────────────────────────────────────────────────────────────────────────────────────

def toplevel() -> Path:
    out = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit('scan-secrets: not inside a git work tree. Refusing to run.')
    return Path(out.stdout.strip())


ROOT = toplevel()
ALLOWLIST = ROOT / 'scripts' / 'secret-allowlist.json'

# Never walked. `git ls-files` already excludes everything ignored, so none of these should appear
# — this is the belt to that set of braces, and it is what keeps the scan survivable in a pnpm
# workspace where an accidentally-tracked build directory would otherwise be tens of thousands of
# files and the hook would simply be turned off.
SKIP_DIRS = {'node_modules', '.next', '.next-verify', '.next-ci', 'build', 'dist', '.git',
             'coverage', '.pnpm-store', '.turbo'}

# Read far enough to find anything real, and stop. A lockfile is the largest text file here by an
# order of magnitude and sits comfortably inside this.
MAX_BYTES = 4 * 1024 * 1024

# ── 1. path rules ───────────────────────────────────────────────────────────────────────────────

# `.env` in any package of the workspace, not just at the root. This repository is a pnpm workspace
# with packages/{web,daemon,sdk}; a single-app path assumption would miss two of the three.
ENV_SHAPED = re.compile(r'(^|/)\.env($|\.)')

# The committed examples. They carry the live mainnet object ids — public data, and CI copies the
# root one into place so the web tests have a configured deployment to read.
ENV_EXEMPT = re.compile(r'(^|/)\.env\.(example|sample|template|defaults)$')

KEY_SHAPED = re.compile(
    r'(^|/)('
    r'[^/]*\.(key|pem|p12|pfx|jks|keystore|asc|gpg)'
    r'|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?'
    r'|signer\.json'
    r'|sui\.keystore'
    r'|secrets?\.env'
    r'|[^/]*test-wallet[^/]*\.json'
    r'|[^/]*(credentials|service[-_]account)[^/]*\.json'
    r')$',
    re.I,
)

# `.secrets/` is already gitignored and holds the throwaway subscribe-path address. A rule here too,
# because "already ignored" is a state a `git add -f` or a rewritten .gitignore can end.
SECRET_DIR = re.compile(r'(^|/)\.secrets(/|$)')

# ── 2. shape rules ──────────────────────────────────────────────────────────────────────────────

# No mnemonic rule. "Twelve consecutive lowercase words" is the shape of English prose, not of a
# seed phrase, and this project's signer is bech32-encoded (`suiprivkey1...`, see
# packages/daemon/src/config.ts) and never a mnemonic.
#
# Bech32's data part cannot contain 1, b, i or o, so the character class below is the real alphabet
# rather than [a-z0-9]. That is what keeps the literal `suiprivkey1...` written in
# packages/daemon/.env.example from matching: dots are not bech32 and the run is far too short.
BECH32 = r'[qpzry9x8gf2tvdw0s3jn54khce6mua7l]'

SHAPES = [
    ('bech32 Sui private key', re.compile(r'suiprivkey1' + BECH32 + r'{40,}')),
    ('PEM private key', re.compile(
        r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----')),
    ('AWS access key id', re.compile(r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b')),
    ('Google API key', re.compile(r'\bAIza[0-9A-Za-z_-]{35}\b')),
    ('Google OAuth client secret', re.compile(r'\bGOCSPX-[0-9A-Za-z_-]{20,}\b')),
    # A dropped GCP service-account key file, whatever it has been renamed to. The daemon's VMs
    # authenticate with the instance's own service account and never a key file, so a key file in
    # this tree is a mistake by construction — see packages/daemon/deploy/provision-social-vm.sh.
    ('GCP service-account key file', re.compile(r'"type"\s*:\s*"service_account"')),
    # All three segments required. pnpm-lock.yaml contains a base64 integrity hash beginning `eyJ`,
    # and a two-segment or prefix-only rule fires on it every time a dependency changes.
    ('JSON Web Token', re.compile(
        r'\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}')),
    ('npm auth token', re.compile(r'_authToken\s*=\s*\S{8,}')),
    ('GitHub token', re.compile(r'\bgh[pousr]_[0-9A-Za-z]{30,}\b')),
    ('Slack token', re.compile(r'\bxox[abprs]-[0-9A-Za-z-]{10,}')),
]

# A URL that carries a password in its authority section, before the host. Written without a
# literal example on purpose: an example of this shape in a comment is itself a match, and the
# first thing a scanner must not do is refuse the commit that installs it.
URL_CRED = re.compile(r'\b[a-z][a-z0-9+.-]*://([^\s/:@]+):([^\s/@"\']+)@([^\s/:?#"\']+)')

# A host reachable only from inside the same machine, job or compose network.
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1', '0.0.0.0',
               'postgres', 'db', 'database', 'host.docker.internal'}

# ── 3. name-anchored rule: a secret-named variable holding a literal ────────────────────────────

# The names that actually carry credentials in this repository. Everything else in a .env here is
# public config — package ids, registry ids, grpc and aggregator URLs, a suggested validator — and
# comparing those produces noise that trains people to ignore the scanner.
SECRET_NAME = re.compile(
    r'PRIVATE_KEY$|PRIVKEY|PASSWORD|SECRET|SEED$|MNEMONIC|(^|_)KEY$|DATABASE_URL$|TOKEN$'
)

# Files where `NAME=value` or `NAME: value` means configuration. Deliberately not .ts/.json: in
# source the shape and identity rules do the work, and a `"password"` JSON key in a fixture is not
# a credential.
CONFIG_SHAPED = re.compile(
    r'(^|/)(\.env[^/]*|Dockerfile[^/]*|[^/]*\.(ya?ml|sh|toml|properties|ini|cfg))$'
)

ASSIGN = re.compile(r'^\s*(?:export\s+|-\s+)?([A-Z][A-Z0-9_]{2,})\s*[:=]\s*(.+?)\s*$')

# A value that is a reference, a template or a stand-in — never the thing itself.
TEMPLATED = re.compile(
    r'\$\{|\$\(|\$[A-Za-z_]|%[sdv]|<[^>]*>|\.\.\.|`|^"?\s*$'
    r'|(?i:\byour[-_ ]|\bchange[-_ ]?me\b|\bexample\b|\bplaceholder\b|\bredacted\b|\bxxx+\b)'
)

MIN_LITERAL = 12


def is_local_url(value: str) -> bool:
    m = URL_CRED.search(value)
    return bool(m) and m.group(3).split(':')[0].lower() in LOCAL_HOSTS


# ── helpers ─────────────────────────────────────────────────────────────────────────────────────

def h(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8', 'ignore')).hexdigest()[:12]


def skipped(path: str) -> bool:
    return bool(SKIP_DIRS & set(Path(path).parts))


def git(*args: str) -> str:
    r = subprocess.run(['git', *args], capture_output=True, text=True,
                       errors='ignore', cwd=ROOT)
    return r.stdout if r.returncode == 0 else ''


def staged_paths() -> list[str]:
    out = git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
    return [p for p in out.split('\n') if p.strip() and not skipped(p)]


def tracked_paths() -> list[str]:
    out = git('ls-files')
    return [p for p in out.split('\n') if p.strip() and not skipped(p)]


def staged_blob(path: str) -> str:
    """The content git would commit, not what is on disk — they differ after a partial `git add`."""
    return git('show', ':' + path)[:MAX_BYTES]


def disk_blob(path: str) -> str:
    try:
        return (ROOT / path).read_text(encoding='utf-8', errors='ignore')[:MAX_BYTES]
    except OSError:
        return ''


# ── identity: what live credentials does this checkout actually hold? ───────────────────────────

# Workspace-wide, because a key can sit beside any package. Globs rather than a fixed list: a
# single-app path here would have covered one third of this repository.
LIVE_GLOBS = [
    '.env', '.env.local', '.env.*.local',
    'packages/*/.env', 'packages/*/.env.local', 'packages/*/.env.*.local',
    'sui-contracts/.env', 'sui-contracts/.env.local',
    '.secrets/*',
    'harvest.key', 'signer.json', '*.key', '*.pem',
    'packages/*/harvest.key', 'packages/*/signer.json', 'packages/*/*.key',
]

JSON_SECRET_VALUE = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"([^"]{12,})"')


def live_secrets() -> dict[str, str]:
    """{value: 'FILE:WHERE'} — read for comparison only. Never staged, never printed."""
    found: dict[str, str] = {}
    seen: set[Path] = set()

    for pattern in LIVE_GLOBS:
        for p in sorted(ROOT.glob(pattern)):
            rel = str(p.relative_to(ROOT))
            if p in seen or not p.is_file() or skipped(rel) or ENV_EXEMPT.search(rel):
                continue
            seen.add(p)
            try:
                text = p.read_text(encoding='utf-8', errors='ignore')
            except OSError:
                continue

            # NAME=VALUE, secret-named only.
            for name, raw in re.findall(r'^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$', text, re.M):
                value = raw.strip().strip('"').strip("'")
                if len(value) >= MIN_LITERAL and SECRET_NAME.search(name):
                    found[value] = f'{rel}:{name}'

            # Raw key material, whatever the file is called.
            for m in re.finditer(r'suiprivkey1' + BECH32 + r'{40,}', text):
                found[m.group(0)] = f'{rel}:bech32 key'

            # JSON key files: only fields whose NAME marks them secret. A 64-hex value on its own
            # is indistinguishable from an object id, and comparing those is what produced 74
            # findings and 0 secrets the last time this estate tried it.
            for name, value in JSON_SECRET_VALUE.findall(text):
                if SECRET_NAME.search(name.upper()):
                    found[value] = f'{rel}:{name}'

    return found


# ── the scan ────────────────────────────────────────────────────────────────────────────────────

def scan(path: str, blob: str, secrets: dict[str, str]) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []

    if ENV_SHAPED.search(path) and not ENV_EXEMPT.search(path):
        out.append((path, 'env-shaped file staged', '-'))
    if KEY_SHAPED.search(path):
        out.append((path, 'key-shaped filename staged', '-'))
    if SECRET_DIR.search(path):
        out.append((path, 'file under .secrets/ staged', '-'))

    if not blob or '\x00' in blob[:8192]:
        return out  # binary: the path rules above are all that can honestly be said about it

    for label, rx in SHAPES:
        for m in rx.finditer(blob):
            out.append((path, label, h(m.group(0))))

    for m in URL_CRED.finditer(blob):
        password, host = m.group(2), m.group(3).split(':')[0].lower()
        if host in LOCAL_HOSTS or TEMPLATED.search(password) or len(password) < 6:
            continue
        out.append((path, 'credential inside a URL', h(password)))

    if CONFIG_SHAPED.search(path):
        for line in blob.splitlines():
            if line.lstrip().startswith('#'):
                continue
            m = ASSIGN.match(line)
            if not m:
                continue
            name, raw = m.group(1), m.group(2).strip()
            if not SECRET_NAME.search(name):
                continue
            value = raw.strip('"').strip("'")
            if len(value) < MIN_LITERAL or TEMPLATED.search(value) or is_local_url(value):
                continue
            label = f'{name} holds a literal value'
            if ENV_EXEMPT.search(path):
                # The committed examples must keep every secret entry blank. A filled-in one here
                # is the likeliest way a real key reaches this repository, because the file looks
                # safe: it is meant to be committed.
                label = f'{name} is not blank in a committed example'
            out.append((path, label, h(value)))

    for value, origin in secrets.items():
        if value in blob:
            out.append((path, f'LIVE SECRET from {origin}', h(value)))

    return out


def load_allowlist() -> dict[str, str]:
    """Fails closed: unreadable, or suppressed with no reason, is a failure and not a skip."""
    if not ALLOWLIST.exists():
        return {}
    try:
        data = json.loads(ALLOWLIST.read_text())
    except Exception as exc:
        raise SystemExit(f'scan-secrets: {ALLOWLIST.name} is unreadable ({exc}). Refusing to run.')
    if not isinstance(data, dict):
        raise SystemExit(f'scan-secrets: {ALLOWLIST.name} must be an object. Refusing to run.')
    entries = {k: v for k, v in data.items() if not k.startswith('_')}
    for key, reason in entries.items():
        if not isinstance(reason, str) or not reason.strip():
            raise SystemExit(
                f'scan-secrets: "{key}" is suppressed with no reason. Refusing to run.')
    return entries


def main() -> int:
    argv = sys.argv[1:]
    allowlist = load_allowlist()

    if '--paths' in argv:
        paths = [p for p in argv[argv.index('--paths') + 1:] if not p.startswith('--')]
        read, mode = disk_blob, 'named path'
    elif '--all' in argv:
        paths, read, mode = tracked_paths(), disk_blob, 'tracked file'
    else:
        paths, read, mode = staged_paths(), staged_blob, 'staged file'

    if not paths:
        print('scan-secrets: nothing to scan')
        return 0

    secrets = live_secrets()
    findings, suppressed = [], 0

    for path in paths:
        for finding in scan(path, read(path), secrets):
            key = '%s:%s:%s' % finding
            if key in allowlist:
                suppressed += 1
                continue
            findings.append(finding)

    note = f', {suppressed} allowlisted' if suppressed else ''
    print(f'scan-secrets: {len(paths)} {mode}(s), '
          f'{len(secrets)} live secret(s) compared{note}')

    if not findings:
        print('scan-secrets: CLEAN')
        return 0

    print(f'scan-secrets: BLOCKED — {len(findings)} finding(s)\n')
    for path, label, digest in findings:
        print(f'  {path}\n      {label}  (sha256:{digest})')
    print('\nNothing was committed. The value is deliberately not shown.')
    print('If this is a real credential it is compromised from the moment it was written down:')
    print('rotate it at the provider first, then remove it here. Removing it here is not the fix.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
