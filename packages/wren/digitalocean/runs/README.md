<!-- Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev> -->

# The deploy's run record

`deploy-droplet.sh --create` appends one JSON line per event to `deploy-runs.jsonl` in this
directory: `create-begin`, `firewall-created`, `droplet-created`, `create-succeeded`, and on any
failure `rollback-begin` and `rollback-done`. Each line carries the UTC time, the droplet id, the
firewall id, the name and the region.

**The rollback rows are written before the destroy, not after.** A rollback that is itself
interrupted — the laptop closing, the token expiring, a Ctrl-C on top of a Ctrl-C — still leaves
the ids of what is running and billed on the account written down here. Heron v1's defect was not
that a droplet leaked; it was that nobody could say afterwards which one.

No value of any kind is recorded: no token, no key, no credential, no address beyond the droplet's
own region. `lib/record-run.py` takes every field from the environment rather than an argv, so
nothing about a run is visible in `ps` while it happens.

`deploy-runs.jsonl` itself is not committed (see the package `.gitignore`): it is what a particular
machine did on a particular day, not source. The estate's record of a deploy is the desk's own
report and the change record; this file is what the operator reads at 3 a.m. when a create half
failed.
