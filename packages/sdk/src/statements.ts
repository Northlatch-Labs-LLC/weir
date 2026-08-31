// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The exact bytes a signature authorises.
 *
 * # One implementation, because a second one is the defect
 *
 * This text used to exist twice: `packages/web/lib/identity.ts` built it for the server, and
 * `packages/agent/src/statements.ts` built it again for headless agents. The two were kept in
 * agreement by a test that diffed them. That test could only ever report a divergence *after* it
 * was written — and it did exactly that: `declare-agent` and `declare-operator` were added to the
 * server copy and not the agent's, and the copies were out of step until somebody ran the suite.
 * A drift test is a smoke alarm; the point of this file is that there is nothing left to burn.
 *
 * Both former copies now re-export this module. Nothing else in the repository may re-implement
 * `statementFor`, and the two remaining hand-written copies — the browser components, which cannot
 * import a server module and are not going to import a wallet-facing SDK into every button — stay
 * pinned by `packages/web/test/statement-drift.test.ts`.
 *
 * # Why the drift matters more than duplication usually does
 *
 * The server never receives the statement. It rebuilds it from the request and verifies the
 * signature against *its* version — deliberately, so a client cannot sign one thing and submit
 * another. The consequence is that a client formatting one character differently produces a
 * signature that verifies against nothing, and the error the user is handed is `the signature does
 * not prove control of 0x…`. That reads as a wallet problem and is not one. **A single space, a
 * single newline, or an em dash where a hyphen belongs is a total failure with a misleading
 * message.** Do not "improve" the formatting below: not the `\n` separators, not the spacing after
 * each colon, not the field order, and not the head.
 *
 * # What is in here, and what is deliberately not
 *
 * This module is **pure**. It has no imports at all, and that is a constraint rather than an
 * accident: this package is Apache-licensed, published, and imported by a browser bundle and by a
 * headless agent alike. It must not acquire Next.js, `server-only`, `pg`, or `node:crypto`.
 *
 * `verifyAction` therefore did **not** move. It reads `siteConfig()`, opens a Postgres connection
 * and spends a row in `used_signatures`; it stays in `packages/web/lib/identity.ts` where the
 * replay ledger lives. Formatting a statement and deciding whether one has already been spent are
 * different jobs, and only the first of them belongs to everyone.
 *
 * `signAction`, `publishContentSha256` and `paidStatementFor` did not move either. They need a
 * keypair and a SHA-256 implementation, and they mirror route logic rather than this file; they
 * stay in `packages/agent/src/statements.ts`.
 */

/**
 * How long a signed statement stays valid. Long enough to type, short enough to matter.
 *
 * Ten minutes. An agent should sign immediately before sending and never hold a statement, which
 * is easy advice for a process with no user to wait for — but the window matters in the other
 * direction too: `verifyAction` refuses a statement dated more than sixty seconds in the future,
 * so an agent on a host with a drifting clock fails every write with a signature error. If writes
 * start failing across the board, check NTP before checking the key.
 */
export const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Every action a signature can authorise.
 *
 * Each member's doc block says what the binding closes — the replay it makes impossible. Read them
 * before adding a field, because an unbound field is a field an attacker chooses.
 */
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
   * better — it would mean one session per post, and therefore a wallet prompt per post, which is
   * the prompt fatigue `isSingleUse` refuses for reads.
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
      /**
       * What this post is sold as. Empty strings when it is not sold at all.
       *
       * `access` alone was bound, which stops a paid post being replayed as free — and stops
       * nothing about *what* is being charged. A captured publish could be replayed with an
       * attacker's own content key and price, creating a post under the victim's handle whose
       * paywall points wherever the attacker chose. The signature authorised the words and the
       * access level; it did not authorise the thing readers must buy.
       */
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
   * Attaching media to a post.
   *
   * Bound to the bytes by hash, so a signature cannot be reused to attach a different file to the
   * same post. Nothing in the interface calls this route today, which makes it surface with no
   * purpose — a signature requirement is the cheapest way to close it without deleting a feature
   * somebody may be about to build.
   */
  | { kind: 'upload'; postId: string; fileSha256: string };

/**
 * The exact bytes a client must sign.
 *
 * Rebuilt on the server from the request, never taken from it. The text is included for a comment
 * so a signature authorises *that* comment — otherwise one signature would authorise an unlimited
 * number of them.
 */
export function statementFor(action: Action, address: string, timestampMs: number): string {
  const head = `Weir\naddress: ${address}\nissued: ${timestampMs}`;
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
    // Nothing may sit between `case` and `return` here: two tests read these cases out of this
    // source with a regex that expects them adjacent, and a comment in the gap makes the case
    // invisible to it — the statement then goes unpinned, which is the one thing this must not be.
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
    case 'upload':
      return `${head}\naction: upload\npost: ${action.postId}\nfile-sha256: ${action.fileSha256}`;
  }
}

/**
 * Does spending this action consume its signature?
 *
 * Everything that changes state does. A signature authorises one post, one message, one follow —
 * not an unlimited number of them for the next ten minutes, which is what freshness alone allowed.
 *
 * `read` does not, and that is a decision rather than an omission. It proves identity for fetching
 * a thread or a notification list, which the client does on a timer; spending it would mean a
 * wallet prompt per refresh. That trains people to approve prompts without reading them, which is
 * strictly worse than the replay it prevents — replaying a read grants exactly the access the
 * signer already had, to the signer.
 *
 * `read-content` **is** spent, and the contrast with `read` is the point. It performs no read; it
 * mints a session cookie that stands in for the signer for a day. Replaying it therefore does not
 * grant the signer what they already had — it hands a *second* session to whoever captured the
 * statement, for an address they do not control. It is signed once a day rather than once a
 * refresh, so spending it costs nobody a prompt they would have noticed.
 *
 * # Exported, but the decision is still not yours
 *
 * This was private to `lib/identity.ts` while the formatter lived there. It is exported now because
 * the formatter moved into a package, and a rule that cannot be read cannot be published — the
 * agent manifest tells machine clients which statements are re-usable, and a manifest that guesses
 * would tell an agent it may batch writes on one prompt. **Publishing the fact is a different act
 * from sharing the decision.** Only `verifyAction` may call this to decide whether a row is spent;
 * everything else may only report what it says.
 */
export function isSingleUse(action: Action): boolean {
  return action.kind !== 'read';
}

/** Lines in the shared head — `Weir`, `address: …`, `issued: …` — before the action begins. */
const HEAD_LINES = 3;

/**
 * One rendering of every action kind, with every interpolated field emptied.
 *
 * The input to {@link STATEMENT_SHAPES}, and the only hand-maintained thing left in this file. It
 * is safe to hand-maintain for a reason the old duplicated table was not: it is a `Record` over
 * `Action['kind']`, so a kind added to the union and forgotten here fails `tsc` rather than
 * quietly going undescribed. The *text* is never written out — it comes from `statementFor`.
 *
 * Two kinds print a **word** where every other prints a slot, so both branches are listed. An agent
 * handed one form and told it was the only one would sign `following: true` and be refused as a
 * forgery.
 */
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
  upload: [{ kind: 'upload', postId: '', fileSha256: '' }],
};

/**
 * The lines one kind emits, in source order, gathered across its branches.
 *
 * Line by line rather than variant by variant, so `follow` reads `['action: follow',
 * 'action: unfollow', 'creator: ']` — both verbs where they occur, not one whole statement after
 * the other. That ordering is the only reason this is worth reading.
 */
function shapeOf(variants: readonly Action[]): readonly string[] {
  const rendered = variants.map((action) => statementFor(action, '', 0).split('\n').slice(HEAD_LINES));
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

/**
 * Every action kind, and the literal lines its statement emits, in order.
 *
 * A description for agent authors: what an implementer should expect to see in the prompt their
 * wallet shows, without reading a switch statement. Fixed text appears whole (`action: comment`);
 * a field that carries a value appears as its prefix and a trailing space (`post: `).
 *
 * # It is derived now, and that is the point of this file
 *
 * It used to be written out by hand, on the stated grounds that "a check that derives its
 * expectation from the code it is checking asserts nothing" — which was correct while it was one
 * half of a drift test between two implementations. There is one implementation now. A hand-copy
 * of its output would be a fourth place for the format to live and the only place it could be
 * wrong, so it is computed from `statementFor` and cannot disagree with what an agent signs.
 *
 * **Changed by that derivation:** `set-perks` now lists `supporters-first: yes` and
 * `supporters-first: no` where the hand table listed the prefix `supporters-first: `. The hand
 * table was inconsistent with its own rule — it named both of `follow`'s rendered verbs and then
 * hid `set-perks`' rendered words behind a slot. Nothing asserted the old value; nothing reads this
 * at runtime.
 */
export const STATEMENT_SHAPES: Readonly<Record<Action['kind'], readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SHAPE_SAMPLES).map(([kind, variants]) => [kind, shapeOf(variants)]),
  ) as Record<Action['kind'], readonly string[]>,
);
