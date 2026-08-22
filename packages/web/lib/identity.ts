// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * Proving who someone is, without a transaction.
 *
 * # Why a signature and not a claimed address
 *
 * Comments and follows move no money, so there is nothing to sign on chain — but an unproven
 * address is worthless as identity. Anyone could post as anyone, and follower counts would mean
 * nothing. So the client signs a short statement with `sui:signPersonalMessage`, which costs no
 * gas, and the server verifies it against the address being claimed.
 *
 * # Replay is bounded by the statement itself
 *
 * The signed statement names the action, the target and a timestamp. A signature is therefore
 * valid for one action on one target, and only briefly — a captured comment signature cannot be
 * replayed onto a different post, and cannot be replayed at all after the window closes. The
 * statement is rebuilt server-side from the request rather than trusted, so a client cannot sign
 * one thing and submit another.
 *
 * This is not a session. Nothing is stored, nothing is issued, and there is nothing to steal.
 */

import { createHash } from 'node:crypto';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { db } from './db';

/** How long a signed statement stays valid. Long enough to type, short enough to matter. */
export const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

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
 */
function isSingleUse(action: Action): boolean {
  return action.kind !== 'read';
}

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
   * be anywhere else in this file.
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
   * Attaching media to a post.
   *
   * Bound to the bytes by hash, so a signature cannot be reused to attach a different file to the
   * same post. Nothing in the interface calls this route today, which makes it surface with no
   * purpose — a signature requirement is the cheapest way to close it without deleting a feature
   * somebody may be about to build.
   */
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
    // Nothing may sit between `case` and `return` here: the drift test reads these cases out of
    // the source with a regex that expects them adjacent, and a comment in the gap makes the case
    // invisible to it — the statement then goes unpinned, which is the one thing this must not be.
    case 'publish':
      return `${head}\naction: publish\ncreator: ${action.handle}\naccess: ${action.access}\ntitle: ${action.title}\ncontent-sha256: ${action.contentSha256}\nkey: ${action.contentKey}\nprice: ${action.price}`;
    case 'name-vault':
      return `${head}\naction: name vault\nvault: ${action.vaultId}\nname: ${action.name}\nbio: ${action.bio}\ncoin: ${action.coinType}`;
    case 'set-profile':
      return `${head}\naction: set profile\nhandle: ${action.handle}\nname: ${action.name}`;
    case 'set-perks':
      return `${head}\naction: set perks\nhandle: ${action.handle}\nperks-sha256: ${action.perksSha256}\nsupporters-first: ${action.supportersFirst ? 'yes' : 'no'}`;
    case 'upload':
      return `${head}\naction: upload\npost: ${action.postId}\nfile-sha256: ${action.fileSha256}`;
  }
}

/**
 * Verify that `address` signed this exact action, recently.
 *
 * `client` is passed to the verifier so zkLogin signatures resolve — they need a chain read to
 * check the ephemeral key's proof, where a plain keypair signature does not. Without it, every
 * zkLogin user would be rejected as a forgery, which is the failure mode that would silently
 * exclude exactly the mainstream users this platform is for.
 */
export async function verifyAction(input: {
  address: string;
  signature: string;
  timestampMs: number;
  action: Action;
}): Promise<Reading<true>> {
  const source = 'signature';
  const age = Date.now() - input.timestampMs;

  if (!Number.isFinite(input.timestampMs)) {
    return fail('malformed', source, 'the timestamp is not a number');
  }
  // Future-dated statements are refused too. Allowing them would let a signature be minted now and
  // held indefinitely, which defeats the window entirely.
  if (age < -60_000) return fail('malformed', source, 'the statement is dated in the future');
  if (age > SIGNATURE_WINDOW_MS) {
    return fail('malformed', source, 'this signature has expired — sign again');
  }

  const config = siteConfig();
  if (!config.ok) return config;

  const message = new TextEncoder().encode(
    statementFor(input.action, input.address, input.timestampMs),
  );

  try {
    // Passing `address` makes the verifier assert the recovered key belongs to it. Without that
    // option a valid signature by *anyone* would pass, which is a check that looks like a check.
    await verifyPersonalMessageSignature(message, input.signature, {
      address: input.address,
      client: createClient(config.value),
    });
  } catch (error) {
    return fail(
      'malformed',
      source,
      `the signature does not prove control of ${input.address}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isSingleUse(input.action)) return ok(true);

  /*
    Spend it.

    After verification, never before: only a signature that has been proved genuine may consume a
    row. Claiming first would let anyone burn arbitrary digests by posting garbage, and — worse —
    a caller who guessed a digest could pre-spend somebody else's signature before they used it.

    `ON CONFLICT DO NOTHING` makes the claim atomic. Two concurrent replays of the same signature
    race for one insert, and Postgres decides; `rowCount` is 1 for exactly one of them. A read of
    "does this digest exist" followed by an insert would leave a window between the two, which is
    the entire attack rewritten as a race.
  */
  const digest = createHash('sha256').update(input.signature).digest();
  const expiresAtMs = input.timestampMs + SIGNATURE_WINDOW_MS;

  try {
    const claimed = await db().query(
      `INSERT INTO used_signatures (digest, expires_at_ms)
       VALUES ($1, $2)
       ON CONFLICT (digest) DO NOTHING`,
      [digest, expiresAtMs],
    );

    if (claimed.rowCount === 0) {
      return fail('malformed', source, 'this signature has already been used — sign again');
    }

    /*
      Sweep what can no longer matter. Opportunistic rather than scheduled: this application has no
      cron, and a table that only grows is how a cheap guard becomes the slowest statement here.

      Bounded, so one unlucky request does not pay for every expired row ever written.
    */
    await db().query(
      `DELETE FROM used_signatures
       WHERE digest IN (SELECT digest FROM used_signatures WHERE expires_at_ms < $1 LIMIT 500)`,
      [Date.now()],
    );
  } catch (error) {
    /*
      Fails closed. A signature we could not record is a signature we cannot promise is unused, and
      accepting it would make replay protection something an attacker turns off by making the
      database unreachable. The cost is that signed writes now require the store — which they
      already did, since every one of them was about to write to it.
    */
    return fail(
      'transport',
      source,
      `could not record this signature, so it was not accepted: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return ok(true);
}
