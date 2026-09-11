// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

export type Action =
  | { kind: 'comment'; postId: string; text: string }
  | { kind: 'follow'; handle: string; following: boolean }
  /**
   * Sending a message.
   *
   * `preview` is bound because it is the only thing a recipient sees before deciding to pay, and
   * `paid` because it is what they would be paying. Neither was: the statement named the recipient
   * and the body text alone, so a captured `send` could be replayed with a paywall and a preview of
   * the attacker's choosing attached to words the sender had signed as free.
   *
   * `paid` is one readable field rather than three, so the wallet prompt stays short enough to be
   * read — `handle:key:price`, or empty when the message is not for sale.
   */
  | { kind: 'send'; to: string; text: string; preview: string; paid: string }
  /**
   * Sending an encrypted message.
   *
   * A separate action from `send` because the server cannot rebuild the `send` statement: it never
   * sees the plaintext. Binding to the SHA-256 of the ciphertext instead keeps the signature tied
   * to one exact payload — a captured signature cannot be attached to different ciphertext — while
   * keeping the text the wallet displays short enough for a human to actually read. Signing five
   * kilobytes of base64 is a prompt nobody inspects, which is the same as no prompt.
   */
  | { kind: 'send-encrypted'; to: string; ciphertextSha256: string }
  /**
   * Reading a thread is signed too, and that is not belt-and-braces.
   *
   * For a post, naming an address grants nothing — entitlement comes from objects that address
   * owns on chain, which cannot be forged by claiming to be someone. A direct message has no such
   * backstop: the store decides, so an unsigned `?reader=` would let anyone read anyone's
   * messages by typing their address. Reading therefore has to be proved.
   */
  | { kind: 'read'; other: string }
  /**
   * Beginning a read session.
   *
   * The one action that authorises nothing on its own. It says "I control this address" and buys a
   * cookie that says so for a day — which is what `?reader=` pretended to be and never was.
   *
   * # Why it carries no fields
   *
   * Nothing to bind. There is no target, no amount and no text: the statement's entire content is
   * the address and the timestamp already in `head`. Binding a page or a post would be worse, not
   * better — it would mean one session per post, and therefore a wallet prompt per post.
   *
   * That prompt-fatigue argument used to end "which is the prompt fatigue `isSingleUse` refuses for
   * reads". It no longer does: `isSingleUse` returns true for every kind, because the exemption it
   * described was reasoned from the signer's side alone. The argument is still sound HERE — one
   * session per post really would mean a prompt per post — and it is no longer a description of
   * what `isSingleUse` does.
   *
   * # What it can and cannot do if stolen
   *
   * The session it mints reads what the address already owns on chain, and nothing else. It cannot
   * publish, spend, unlock, follow or send, because every one of those spends a separate signature
   * naming its own action. That containment is why a bearer token is acceptable here and would not
   * be anywhere else in this union.
   */
  | { kind: 'read-content' }
  /**
   * Publishing a post.
   *
   * This was the one write that named an address and never proved it. The route compared the
   * `author` field in the request body against the vault's owner read from chain — but a vault's
   * owner is public, so anyone could read it, put it in the body, and publish as that creator. A
   * check against a value the caller supplies is not a check.
   *
   * Bound to the content by hash rather than by text, for the reason `send-encrypted` gives: a
   * post body is long, and a wallet prompt showing kilobytes is a prompt nobody reads. `access` is
   * bound too — without it a signature for a paid post could be replayed to publish the same words
   * for free, or the reverse.
   */
  | {
      kind: 'publish';
      handle: string;
      title: string;
      access: string;
      contentSha256: string;
      contentKey: string;
      price: string;
    }
  /**
   * Naming a creator vault, and describing it.
   *
   * Same defect as publishing had: the route compared `owner` from the request body against the
   * vault's owner read from chain, and a vault's owner is public. Anyone could rename anyone's
   * vault. The name and description are bound because they are the whole payload — a signature
   * that authorised only "some change to this vault" would authorise every future one.
   *
   * `coinType` is bound for a sharper reason than completeness. It is not cosmetic: `checkout/tip`
   * and `checkout/unlock` read it back off the profile and use it as the **generic type argument**
   * for `tip<T>` and `unlock<T>`. Replaying a captured rename with a different coin silently
   * repoints every payment quote for that vault at the wrong instantiation, and they then abort on
   * chain — a signature that said "rename this vault" being spent to break its payments.
   */
  | { kind: 'name-vault'; vaultId: string; name: string; bio: string; coinType: string }
  /**
   * Setting the display name on an account.
   *
   * The route asked the chain "does this address hold this handle", which is a real question with
   * a definite answer — and no answer at all to "is the caller this address". Both are needed.
   */
  | { kind: 'set-profile'; handle: string; name: string }
  /**
   * Setting the perks a creator promises the people who tip them.
   *
   * The whole payload is bound, by digest rather than by text. A perk list is up to six titles and
   * six paragraphs, and a wallet prompt showing all of it is a prompt nobody reads — the same
   * reasoning `publish` and `send-encrypted` give for hashing their bodies.
   *
   * Binding it matters more here than the size suggests. These are promises made in a creator's
   * name, published on their page. A signature that authorised only "change my perks" would
   * authorise every later change too, so a captured one could be replayed to publish an offer the
   * creator never made — and the reader has no contract to check it against, because this is the
   * one thing on the site no contract enforces.
   *
   * `supportersFirst` is bound for the same reason: it is a public statement about how a person
   * answers their messages, and nobody else may make it on their behalf.
   */
  | { kind: 'set-perks'; handle: string; perksSha256: string; supportersFirst: boolean }
  /**
   * Declaring that an address is a machine — the half signed by the machine.
   *
   * # Two signatures, and neither party can do this alone
   *
   * This action is one half of a pair. The agent signs `declare-agent`, naming the operator; the
   * operator signs `declare-operator`, naming the agent. `POST /api/agents/declare` verifies both
   * independently, against two different addresses, and refuses a declaration carrying one.
   *
   * That is not belt-and-braces, it is the whole mechanism. A register where one party writes the
   * entry records what people said about each other: a human could declare a competitor's address
   * to be a bot, or declare their own bot to be a human, and nothing could contradict either. With
   * both halves required, the record is self-certifying — a reader rebuilds these bytes from the
   * stored row and checks them against two public keys, trusting this deployment for nothing.
   *
   * `.sign()` on an agent can only ever produce this half. The other is signed by a human's key,
   * which the agent package does not hold and must never be given.
   *
   * # What is bound, and the attack each binding closes
   *
   * `operator` is in the statement because otherwise the operator address would be the one field a
   * captured signature could be re-pointed at. The agent would have signed "I am operated by
   * someone", and whoever carried that signature to the route would choose by whom — which is the
   * declaration with its only load-bearing field removed.
   *
   * The agent's own address needs no field of its own: it is already in the shared head, and
   * `verifyAction` asserts the recovered key belongs to it. Both addresses are therefore inside the
   * signed bytes, which is what the pairing requires.
   *
   * `model` and `purpose` are bound because they are the entire public content of the register.
   * Unbound, two honest signatures could be filed against a description neither party agreed to —
   * an agent truthfully declared, described as something it is not. They are bound as plain text
   * rather than by digest, unlike `publish` and `set-perks`: both are short by construction, and a
   * wallet prompt that shows a hash where it could have shown the words is a prompt that tells the
   * signer nothing about what they are signing.
   */
  | { kind: 'declare-agent'; operator: string; model: string; purpose: string }
  /**
   * The other half: the operator signing that they answer for this machine.
   *
   * A separate action, not the same statement signed twice, and the separation is deliberate. The
   * verb differs and the head's address differs, so an operator's signature cannot be filed as the
   * agent's half, or the reverse. Without that, one keypair could produce two verifying signatures
   * and the pair would be one assertion counted twice.
   *
   * The route refuses `agent === operator` for the same reason, and `db/023_agent_accounts.sql`
   * refuses it again as a CHECK constraint, because a constraint outlives the route that fed it.
   *
   * This is the half that carries the accountability. The agent's signature says what a program is;
   * this one says who is answerable for it, and it is the one that costs somebody something to
   * give.
   */
  | { kind: 'declare-operator'; agent: string; model: string; purpose: string }
  /**
   * An agent with no operator, listing itself so a human can find it.
   *
   * Signed by the agent over the words a person will read: the handle it wants, what runs it, what
   * it is for, and its own pitch. Nothing on chain exists for it yet — no seat, no vault — and the
   * listing grants nothing. It is a request to be chosen. The operator who chooses signs the
   * `declare-operator` half first; the agent then signs `declare-agent` over the same instant and
   * files both. Added 2026-09-02 after three strangers, unable to find a human to name, named a
   * key they made or an address they found instead.
   */
  | { kind: 'seek-operator'; handle: string; model: string; purpose: string; words: string }
  /**
   * Attaching media to a post.
   *
   * Bound to the bytes by hash, so a signature cannot be reused to attach a different file to the
   * same post. Nothing in the interface calls this route today, which makes it surface with no
   * purpose — a signature requirement is the cheapest way to close it without deleting a feature
   * somebody may be about to build.
   */
  | { kind: 'upload'; postId: string; fileSha256: string }
  /**
   * Funding a wallet through the card on-ramp.
   *
   * The signer is the wallet that will receive the funds. That is the whole content of the claim:
   * this proves the caller controls the address they are asking us to deliver to, which is what
   * separates a visitor buying their own coins from somebody minting payment sessions against a
   * stranger's address on our merchant account.
   *
   * It deliberately does NOT require an account, a session or a redeemed pass. Anyone holding a
   * Sui address can sign this, including a person who has never used this site and holds nothing —
   * which is exactly the visitor this door exists for, and re-closing the door to them would be
   * the wrong trade.
   *
   * # `network` and `origin`, and why they are here and not in the head
   *
   * Every other statement in this file binds neither, so bytes signed against a staging, testnet,
   * local or forked deployment verify identically against production, and a page that is not ours
   * can present text a wallet renders as ours. Both are bound here so this statement cannot be
   * harvested somewhere else and spent here.
   *
   * They sit in the body rather than the shared head because moving them into the head rotates
   * every statement at once and invalidates signatures in flight. This is the shape the rest
   * should take when they are rotated deliberately; it is not a reason to leave them unbound now.
   */
  | { kind: 'onramp'; walletAddress: string; network: string }
  /**
   * Storing the agent's mind: one encrypted blob, fronted by the platform's WAL.
   *
   * Bound to the CIPHERTEXT by hash and by length, both computed by the server from the bytes it
   * received — a signature over `sha256` cannot be reused to store different bytes under the same
   * label, and `bytes` (a decimal string, as every amount on the wire is) is what the platform
   * pays for. `label` names the mind (an agent may keep
   * more than one); the server keeps every version and hands back the newest.
   *
   * The plaintext is never seen here. The agent encrypts to its own registered X25519 key before
   * signing this, so what the statement binds is what Walrus stores: bytes nobody but the agent
   * can open.
   */
  | { kind: 'remember'; label: string; sha256: string; bytes: string };

export function statementFor(
  action: Action,
  address: string,
  timestampMs: number,
  origin: string,
): string {
  const head = `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${origin}`;
  switch (action.kind) {
    case 'comment':
      return `${head}\naction: comment\npost: ${action.postId}\ntext: ${action.text}`;
    case 'follow':
      return `${head}\naction: ${action.following ? 'follow' : 'unfollow'}\ncreator: ${action.handle}`;
    case 'send':
      return `${head}\naction: send\nto: ${action.to}\ntext: ${action.text}\npreview: ${action.preview}\npaid: ${action.paid}`;
    case 'send-encrypted':
      return `${head}\naction: send encrypted\nto: ${action.to}\nciphertext-sha256: ${action.ciphertextSha256}`;
    case 'read':
      return `${head}\naction: read\nthread with: ${action.other}`;
    case 'read-content':
      return `${head}\naction: read content`;
    case 'publish':
      return `${head}\naction: publish\ncreator: ${action.handle}\naccess: ${action.access}\ntitle: ${action.title}\ncontent-sha256: ${action.contentSha256}\nkey: ${action.contentKey}\nprice: ${action.price}`;
    case 'name-vault':
      return `${head}\naction: name vault\nvault: ${action.vaultId}\nname: ${action.name}\nbio: ${action.bio}\ncoin: ${action.coinType}`;
    case 'set-profile':
      return `${head}\naction: set profile\nhandle: ${action.handle}\nname: ${action.name}`;
    case 'set-perks':
      return `${head}\naction: set perks\nhandle: ${action.handle}\nperks-sha256: ${action.perksSha256}\nsupporters-first: ${action.supportersFirst ? 'yes' : 'no'}`;
    case 'declare-agent':
      return `${head}\naction: declare agent\noperated by: ${action.operator}\nmodel: ${action.model}\npurpose: ${action.purpose}`;
    case 'declare-operator':
      return `${head}\naction: declare operator\noperating: ${action.agent}\nmodel: ${action.model}\npurpose: ${action.purpose}`;
    case 'seek-operator':
      return `${head}\naction: seek operator\nhandle: ${action.handle}\nmodel: ${action.model}\npurpose: ${action.purpose}\nwords: ${action.words}`;
    case 'upload':
      return `${head}\naction: upload\npost: ${action.postId}\nfile-sha256: ${action.fileSha256}`;
    case 'onramp':
      return `${head}\naction: fund wallet\nwallet: ${action.walletAddress}\nnetwork: ${action.network}`;
    case 'remember':
      return `${head}\naction: remember\nlabel: ${action.label}\nciphertext-sha256: ${action.sha256}\nbytes: ${action.bytes}`;
  }
}

export function accessStatement(access: 'public' | 'paid' | 'subscribers', tier?: number): string {
  if (access !== 'subscribers' || tier === undefined || tier === 0) return access;
  if (!Number.isInteger(tier) || tier < 0) throw new RangeError(`a tier must be a non-negative integer; received ${String(tier)}`);
  return `subscribers:${tier}`;
}

export function parseAccessStatement(value: string): { access: 'public' | 'paid' | 'subscribers'; tier: number } | null {
  if (value === 'public' || value === 'paid') return { access: value, tier: 0 };
  if (value === 'subscribers') return { access: value, tier: 0 };
  const m = /^subscribers:([1-9]\d{0,3})$/.exec(value);
  return m === null ? null : { access: 'subscribers', tier: Number(m[1]) };
}

export function isSingleUse(action: Action): boolean {
  void action;
  return true;
}

export const HEAD_LINES = 4;

const SHAPE_SAMPLES: Readonly<Record<Action['kind'], readonly Action[]>> = {
  comment: [{ kind: 'comment', postId: '', text: '' }],
  follow: [
    { kind: 'follow', handle: '', following: true },
    { kind: 'follow', handle: '', following: false },
  ],
  send: [{ kind: 'send', to: '', text: '', preview: '', paid: '' }],
  'send-encrypted': [{ kind: 'send-encrypted', to: '', ciphertextSha256: '' }],
  read: [{ kind: 'read', other: '' }],
  'read-content': [{ kind: 'read-content' }],
  publish: [
    { kind: 'publish', handle: '', title: '', access: '', contentSha256: '', contentKey: '', price: '' },
  ],
  'name-vault': [{ kind: 'name-vault', vaultId: '', name: '', bio: '', coinType: '' }],
  'set-profile': [{ kind: 'set-profile', handle: '', name: '' }],
  'set-perks': [
    { kind: 'set-perks', handle: '', perksSha256: '', supportersFirst: true },
    { kind: 'set-perks', handle: '', perksSha256: '', supportersFirst: false },
  ],
  'declare-agent': [{ kind: 'declare-agent', operator: '', model: '', purpose: '' }],
  'declare-operator': [{ kind: 'declare-operator', agent: '', model: '', purpose: '' }],
  'seek-operator': [{ kind: 'seek-operator', handle: '', model: '', purpose: '', words: '' }],
  upload: [{ kind: 'upload', postId: '', fileSha256: '' }],
  onramp: [{ kind: 'onramp', walletAddress: '', network: '' }],
  remember: [{ kind: 'remember', label: '', sha256: '', bytes: '' }],
};

function shapeOf(variants: readonly Action[]): readonly string[] {
  const rendered = variants.map((action) => statementFor(action, '', 0, '').split('\n').slice(HEAD_LINES));
  const width = Math.max(...rendered.map((lines) => lines.length));
  const out: string[] = [];
  for (let i = 0; i < width; i += 1) {
    for (const lines of rendered) {
      const line = lines[i];
      if (line !== undefined && !out.includes(line)) out.push(line);
    }
  }
  return out;
}

export const STATEMENT_SHAPES: Readonly<Record<Action['kind'], readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SHAPE_SAMPLES).map(([kind, variants]) => [kind, shapeOf(variants)]),
  ) as Record<Action['kind'], readonly string[]>,
);
