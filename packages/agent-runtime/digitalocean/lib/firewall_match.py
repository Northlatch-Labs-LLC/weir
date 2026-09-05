#!/usr/bin/env python3
"""Built-by: @projectx.sui /|\\ - Co-authored-by: Kaela <kaela@projectxprotocol.dev>

Compares the firewall rules deploy-droplet.sh ASKED for against the ones DigitalOcean echoes back.

Why this file exists at all. The create call sends one key inside each rule's source/destination
object:

    {"protocol": "tcp", "ports": "22", "sources": {"addresses": ["203.0.113.4"]}}

and the API echoes back all four:

    {"protocol": "tcp", "ports": "22",
     "sources": {"addresses": ["203.0.113.4"], "droplet_ids": [], "tags": [],
                 "load_balancer_uids": []}}

A `readback["inbound_rules"] != inbound` on the raw objects therefore compares unequal for a
firewall that is exactly right, and the deploy refuses a correct firewall every time (Security's B5
on step 6). It failed closed, which was the right direction -- but paired with no destroy-on-failure
trap it stranded a running, billed droplet.

What is compared, and it is the whole comparison: protocol (case-folded), ports (normalised), and
the SORTED address list. What is deliberately ignored: droplet_ids, tags and load_balancer_uids in
the echo, because the request does not send them and the attachment is asserted separately by the
create body's own droplet_ids.

Both directions are compared as sorted multisets, so an EXTRA rule in the readback is a mismatch
just as loudly as a missing one -- a firewall that admits more than it was asked to admit is the
failure that matters most here.

Usage:
    firewall_match.py <requested.json> <readback.json>
      each file: {"inbound_rules": [...], "outbound_rules": [...]}
      exit 0  - every rule matches, in both directions
      exit 1  - the differences are printed, one per line, and nothing is guessed
      exit 2  - usage error or unreadable/unparsable input
"""
import json
import sys

SIDE_KEY = {"inbound": "sources", "outbound": "destinations"}


def normalise_ports(value: object) -> str:
    """DigitalOcean writes a whole-range port as "0" in a request and "all" in an echo."""
    text = str(value).strip().lower()
    return "all" if text in ("0", "all", "") else text


def normalise_rule(rule: dict, direction: str) -> tuple:
    side = rule.get(SIDE_KEY[direction]) or {}
    addresses = tuple(sorted(str(a) for a in (side.get("addresses") or [])))
    return (str(rule.get("protocol", "")).strip().lower(), normalise_ports(rule.get("ports", "")), addresses)


def describe(rule: tuple) -> str:
    protocol, ports, addresses = rule
    return f"{protocol}/{ports} from|to [{', '.join(addresses)}]"


def differences(requested: dict, readback: dict) -> list[str]:
    """Every way the two disagree, named. An empty list is the only thing that means 'match'."""
    out: list[str] = []
    for direction in ("inbound", "outbound"):
        key = f"{direction}_rules"
        asked = sorted(normalise_rule(r, direction) for r in (requested.get(key) or []))
        got = sorted(normalise_rule(r, direction) for r in (readback.get(key) or []))
        if asked == got:
            continue
        for rule in asked:
            if got.count(rule) < asked.count(rule):
                out.append(f"{direction}: asked for {describe(rule)} and the firewall does not have it")
        for rule in got:
            if asked.count(rule) < got.count(rule):
                out.append(f"{direction}: the firewall has {describe(rule)} and it was never asked for")
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("firewall_match.py: usage: firewall_match.py <requested.json> <readback.json>", file=sys.stderr)
        return 2
    try:
        with open(argv[1], encoding="utf-8") as handle:
            requested = json.load(handle)
        with open(argv[2], encoding="utf-8") as handle:
            readback = json.load(handle)
    except (OSError, ValueError) as exc:
        print(f"firewall_match.py: could not read the rules: {exc}", file=sys.stderr)
        return 2

    # A readback is often the whole firewall object; accept either it or the rules alone.
    readback = readback.get("firewall", readback)

    problems = differences(requested, readback)
    if problems:
        print("FIREWALL READBACK MISMATCH", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print("firewall readback matches what was asked: protocol, ports and addresses, both directions")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
