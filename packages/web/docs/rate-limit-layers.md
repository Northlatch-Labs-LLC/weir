# Rate limiting — the four layers

Two of these are not code. Layer 1 is Cloudflare configuration and Layer 4 is on chain, so nothing
in this repository can assert that either is in place — which is why they are written down here and
why `packages/web/test/rate-limit-breaker.test.ts` reads this file and fails if a layer loses its
section. It lived in a doc comment at the top of `lib/rate-limit.ts` until 2026-09-11.

A ceiling on how often one caller may hit an endpoint.

# What this defends, and what it does not

Not authentication. Every route worth protecting already proves who the caller is, or needs no
proof because it writes nothing. What was missing is a limit on *volume*: the simulate and
prepare routes each build a transaction and call a fullnode, so an unauthenticated loop spends
this deployment's CPU and its share of a public, rate-limited RPC endpoint until real visitors
start seeing failures. There is nothing to steal there; there is plenty to exhaust.

# Why the state lives here rather than in `proxy.ts`

A proxy is the obvious single place to put this, and Next's own documentation rules it out: a
proxy "in optimized cases [is] deployed to your CDN" and must not "rely on shared modules or
globals". A counter is nothing but shared state, so it would be correct on one deployment and
silently useless on another. Route handlers run in the Node runtime, where module state does
persist for the life of an instance.

# The honest limitation

Serverless multiplies instances, and each instance counts on its own. A caller spread across many
instances gets more than `limit` requests, and an attacker who can force new instances gets
proportionally more. This stops a naive loop against a warm instance — the common case, and the
cheap one to stop — and it is **not** a substitute for a platform firewall at the edge. Anything
stronger belongs in front of the application rather than inside it.

**And the limitation is wider than the paragraph above says.** That paragraph is about instances.
The other half is about *keys*: every counter in this file, in-process or in Postgres, is keyed on
something the caller supplies or owns — a network address, or a Sui address. Both are cheap. An
address costs gas and nothing else, so an adversary willing to spend a few SUI holds ten thousand
of them, and ten thousand full buckets is ten thousand times the ceiling. **A per-key limiter
bounds one runaway caller. It does not bound an adversary, and it never did.** That is not a
defect in the arithmetic below; it is what per-key limiting is. It is why {@link tripBreaker}
exists, and why layer 1 is not optional.

# Two halves, and which one is the ceiling

That limitation was survivable while every caller was a browser. A person makes a handful of
requests a minute and lands on one warm instance, so `limit x instances` and `limit` are the same
number to them. An agent is the opposite: deliberately concurrent, retrying on failure, and
running at the rate that makes a browser limiter bite. For that caller `limit x instances` is not
a ceiling but a number they raise by opening connections — and one the platform raises for them
by scaling out under exactly the load that needed limiting.

So this file now holds three things, and they are not interchangeable:

  * {@link rateLimit} — unchanged, in-process, keyed on the network address of an **anonymous**
    caller. It is the only thing available where there is no identity to key on, which is most of
    the public surface. It remains best-effort and remains not a firewall.
  * {@link quotaLimit} — a Postgres token bucket keyed on the **Sui address** of an authenticated
    caller, shared by every instance. It is the ceiling that holds **for one address**, and it is
    what bounds one agent that has gone wrong. `025_quotas.sql` carries the concurrency argument
    in full. **It is not the ceiling on agent traffic**, and an earlier version of this doc block
    said it was. Correcting that sentence is the whole reason the paragraph above it exists: the
    claim was true about a caller and was read as a claim about the load, and those differ by
    however many addresses somebody is willing to fund.
  * {@link tripBreaker} — one Postgres bucket for the **whole deployment**, not keyed on the
    caller at all. It is the only counter here an adversary cannot dilute by minting keys, and it
    is the one an operator can set to zero to stop agent traffic without a deploy.

The address-keyed half could not simply replace the other. It needs an identity the caller has
proved, and it costs a round trip to Postgres; applying it to anonymous reads would key thousands
of strangers into one bucket and put a database write on the front page. The two run together —
volume by network address at the door, quota by identity once the caller is known.

# The four layers, and what each one does NOT defend

Written out because every one of them has been mistaken for the others at some point in this
file's life, and each mistake looks like coverage.

**Layer 1 — edge, volumetric, per-IP and per-ASN. Configuration in Cloudflare, not code.**
It is the only layer that sees a request this application never pays for, and the only one that
can absorb a flood rather than merely refuse it: an application-layer 429 still costs a function
invocation, a TLS handshake and a database round trip, so a limiter inside the process is a
limiter the attacker is still paying us to run. **It does not know who anybody is.** It cannot
tell one agent's thousand requests from a thousand readers' one, so it must be set loose enough
to never touch a real audience — which means it is a flood stop and nothing finer. The exact
rules to create are written out under "The rules to create in Cloudflare" below, because a layer
that lives in somebody's dashboard and nowhere in the repository is a layer that is lost the
first time the account changes hands.

**Layer 2 — identity, the Postgres token bucket per Sui address ({@link quotaLimit}).**
It is the only layer that can price a *kind* of request, which is why `purchase` is 10 and `read`
is 600 — an agent looping on the buy path can lose ten purchases before it is stopped, and the
number is a judgement about money rather than about CPU. `publish` and `message` are here for the
same reason and were not: publishing and sending were bounded only by `rateLimit`, so the ceiling
on how much content one identity could produce was `limit x instances` — a number nobody chose,
which rises with the traffic testing it. **It does not defend against an
adversary**, per the paragraph above: buckets are per address and addresses are cheap. It bounds
a mistake, not an attack.

**Layer 3 — the global circuit breaker ({@link tripBreaker}).**
One bucket for the entire deployment, spent by every identified agent request whatever address it
arrives under, so ten thousand addresses spend ten thousand tokens from the same bucket rather
than from ten thousand of their own. Env-driven, so the ceiling moves — and `0` closes it — with
no deploy and no code review at the moment somebody needs it closed. **It does not distinguish
the guilty from the innocent.** A tripped breaker refuses a well-behaved agent exactly as it
refuses the one that tripped it; that is the trade being made deliberately, because the state it
exists for is the one where a person needs the traffic to stop now and can sort out who was at
fault afterwards. It also does not see anonymous browser traffic at all — that is layers 1 and 4.

**Layer 4 — economic, and it is on chain rather than here.**
Gas on every address ever funded; the 29 SUI creation fee bonding a vault; `payments_paused` on
the `Platform` object, which stops settlement for everybody regardless of what any HTTP layer
decided. It is the only layer that survives this application being wrong, unavailable or
bypassed entirely — a caller who goes straight to a fullnode never touches layers 1 to 3 and
still cannot move money past it. **It does not protect the infrastructure.** Reads cost nothing
on chain, so nothing economic bounds an adversary who only wants to exhaust our fullnode share,
and `payments_paused` is a switch for the whole platform rather than for one caller.

# The rules to create in Cloudflare

Layer 1 is configuration, and it is recorded here because nothing in this repository can assert
it. `PROJECTX_SOCIAL_BEHIND_CLOUDFLARE` must be `true` for the proxy to be in front at all — see
{@link clientKey}, which refuses to trust `cf-connecting-ip` until it is, and must be turned off
in the same change that removes the proxy.

  1. **Rate limiting rule — the agent surface.**
     Expression: `(starts_with(http.request.uri.path, "/api/") and not
     starts_with(http.request.uri.path, "/api/auth"))`
     Characteristics: `ip.src`. Period 60 s, requests 600, mitigation Block, timeout 60 s.
     Response: 429 with a JSON body, so a client parses a refusal here the same way it parses
     {@link rateLimit}'s.
  2. **Rate limiting rule — the money path, tighter.**
     Expression: `(starts_with(http.request.uri.path, "/api/checkout/"))`
     Characteristics: `ip.src`. Period 60 s, requests 60, mitigation Block, timeout 300 s.
  3. **Rate limiting rule — the whole origin, per ASN rather than per IP.**
     Expression: `(http.host eq "weir.social")`
     Characteristics: `ip.geoip.asnum`. Period 60 s, requests 20000, mitigation Managed Challenge.
     This is the one that sees a botnet spread across a hosting provider, which per-IP cannot.
  4. **WAF custom rule — refuse an unidentifiable machine on the write surface.**
     Expression: `(http.request.method in {"POST" "PUT" "DELETE"} and
     starts_with(http.request.uri.path, "/api/") and http.user_agent eq "")`
     Action: Block. The manifest's `disclosure.userAgent` asks every agent for a contactable
     User-Agent; this makes the empty case cost something without inspecting the contents, which
     the manifest is careful to say we do not do.
  5. **WAF custom rule — never challenge the discovery document.**
     Expression: `(http.request.uri.path eq "/.well-known/weir-agent.json")`
     Action: Skip (all remaining custom rules, rate limiting rules and Super Bot Fight Mode).
     A manifest behind a browser challenge is a manifest no program can read, which is the same
     outage as not publishing one.
  6. **Bot Fight Mode: off, or Super Bot Fight Mode with "Definitely automated" set to Allow on
     `/api/` and `/.well-known/`.** This platform invites machine callers by design and asks them
     to declare themselves; a blanket bot block would refuse exactly the traffic the register
     exists to admit. Leave the challenge for `/admin` and the browser surface.

None of the six is asserted by any test in this repository, and no test can assert them. They are
written here so that the day somebody asks what layer 1 is, the answer is a diff and not a memory.
