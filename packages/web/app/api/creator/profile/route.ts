// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, fold, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { findProfile, findProfileByVault, upsertProfile } from '@/lib/content';
import { accountHandle } from '@/lib/accounts';
import { verifyAction } from '@/lib/identity';
import { coinTypeOf } from '@/lib/creator-setup';

/**
 * What a creator may write about themselves.
 *
 * Exported so the composer, this route and the tests read ONE pair of numbers. They were literals
 * at two call sites in this file and nowhere else, which is how a limit gets changed in one place.
 */
export const MAX_DISPLAY_NAME_LENGTH = 60;
export const MAX_BIO_LENGTH = 280;

export const dynamic = 'force-dynamic';

/**
 * Name a vault, so content can hang off it.
 *
 * # Ownership is read from chain, never taken from the request
 *
 * The vault's `owner` field decides who may name it. A form field claiming to be the owner buys
 * nothing: the vault is read and the claim is checked against it. Without that, anyone could
 * rename any creator's profile — the store has no other notion of who owns what.
 *
 * # And the handle is the one the registry holds
 *
 * Not a name typed into this form. `account::Registry` already says which handle this address
 * owns, and letting a profile carry a different one would create a second, softer identity that
 * looks the same in a URL and is backed by nothing.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    owner?: string; vaultId?: string; coinType?: string; displayName?: string; bio?: string;
    signature?: string; timestampMs?: number;
  };
  if (!b.owner || !b.vaultId || !b.coinType) {
    return NextResponse.json({ error: 'owner, vaultId and coinType are required' }, { status: 400 });
  }

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({ error: config.failure.detail }, { status: 503 });
  }

  const client = createClient(config.value);
  const vault = await readCreatorVault(client, b.vaultId);
  if (!vault.ok) {
    return NextResponse.json(
      { error: `the vault could not be read: ${vault.failure.detail}` },
      { status: 424 },
    );
  }
  const tooLong =
    (b.displayName ?? '').length > MAX_DISPLAY_NAME_LENGTH
      ? `displayName exceeds ${MAX_DISPLAY_NAME_LENGTH} characters`
      : (b.bio ?? '').length > MAX_BIO_LENGTH
        ? `bio exceeds ${MAX_BIO_LENGTH} characters`
        : null;
  if (tooLong !== null) return NextResponse.json({ error: tooLong }, { status: 400 });

  const proof = await verifyAction({
    origin: new URL(request.url).origin,
    address: b.owner,
    signature: b.signature ?? '',
    timestampMs: b.timestampMs ?? 0,
    action: {
      kind: 'name-vault',
      vaultId: b.vaultId,
      // Bound because it decides the generic type argument every later payment against this vault
      // is built with, not because it is part of the name.
      coinType: b.coinType,
      name: b.displayName ?? '',
      bio: b.bio ?? '',
    },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  if (vault.value.owner.toLowerCase() !== b.owner.toLowerCase()) {
    return NextResponse.json(
      { error: 'that vault belongs to a different address' },
      { status: 403 },
    );
  }

  /*
    The coin type is the vault's type parameter, read from chain, and the body must agree with it.
    This route's own rule is "ownership is read from chain, never taken from the request", and the
    coin was the one field it took from the request: a creator who signed the wrong coin type
    stored a denomination every buyer's subscribe/tip/unlock was then built with, and every one
    of those simulations failed with a type mismatch until somebody read the row.
  */
  const onChainCoin = await coinTypeOf(client, b.vaultId);
  if (onChainCoin === null) {
    return NextResponse.json({ error: 'the vault\'s coin type could not be read from chain' }, { status: 424 });
  }
  if (normaliseCoinType(onChainCoin) !== normaliseCoinType(b.coinType)) {
    return NextResponse.json(
      { error: `coinType does not match the vault: the vault is denominated in ${onChainCoin}` },
      { status: 400 },
    );
  }
  /*
    Prove the caller controls `owner`, rather than taking the body's word for it.

    The check below compares the request's `owner` against the vault's owner read from chain, and
    on its own it authorises nothing: a vault's owner is public, so anybody could read it, send it
    and rename somebody else's vault. The name and description are bound into the statement because
    they are the entire payload — a signature authorising "some change to this vault" would
    authorise every later one too.
  */
  /*
    Bounded before the signature is checked, and refused rather than trimmed.

    These two fields used to be sliced to 60 and 280 AFTER `verifyAction` returned, so what was
    stored was not what the signature covered. A creator who signed a 300-character bio had 280 of
    it stored under a signature attesting to the other shape — and the whole reason the name and bio
    are bound into the statement is that they ARE the payload. A signature covering bytes that were
    never stored authorises a thing that never happened.

    Refused rather than silently shortened, and refused BEFORE verification, for the reason
    `POST /api/posts` gives for its own length checks: rejecting afterwards would spend a
    single-use signature on a request that was never going to be stored, so the creator would have
    to sign again to find out. The length reported is the one they actually sent, not one this
    route trimmed to.
  */


  const handle = await accountHandle(b.owner);
  if (!handle.ok) {
    return NextResponse.json({ error: handle.failure.detail }, { status: 424 });
  }
  if (handle.value === null) {
    return NextResponse.json(
      { error: 'this address holds no account, so it has no handle to publish under' },
      { status: 400 },
    );
  }

  /*
    A creator may own several vaults, and `profiles` is keyed by handle — so the second vault would
    overwrite the first's row. Suffixed rather than refused: the handle stays the identity and the
    extra vaults get a stable, derived name instead of silently replacing each other.
  */
  /*
    The row that already names this vault wins, whatever handle it is filed under.

    Without this the key came from the chain's handle alone, so an account whose row was filed under
    an older name got a *second* row every time it saved: the write succeeded, returned 200, and
    every page carried on reading the first row. The creator saw their display name and bio refuse
    to change, and saving again made another duplicate rather than fixing it.

    Asking by vault is asking the question this endpoint means — "which row names the thing I am
    naming" — and it is now backed by a unique index, so there can only ever be one answer.
  */
  const claimed = await findProfileByVault(b.vaultId);
  if (claimed !== null) {
    await upsertProfile({
      ...claimed,
      owner: b.owner,
      /*
        Stored exactly as signed. The handle stands in only when the field is ABSENT — a display
        fallback for something never supplied, not a modification of something that was.
      */
      displayName: b.displayName ?? claimed.handle,
      bio: b.bio ?? '',
      coinType: b.coinType,
    });
    return NextResponse.json({ handle: claimed.handle });
  }

  let slug = handle.value;
  const existing = await findProfile(slug);
  /*
    `existing.vaultId` may be null — a page can exist for an account with no vault yet. That is not
    "a different vault"; it is the row this vault should claim, so it keeps the plain slug rather
    than being pushed onto a suffixed one.

    Without the null check this threw at runtime on `.toLowerCase()`, and the only reason it was not
    caught earlier is that `tsc` was reusing an incremental cache from before `vaultId` became
    nullable.
  */
  if (
    existing !== null &&
    existing.vaultId !== null &&
    existing.vaultId.toLowerCase() !== b.vaultId.toLowerCase()
  ) {
    slug = `${handle.value}-${b.vaultId.slice(2, 6)}`;
  }

  await upsertProfile({
    handle: slug,
    vaultId: b.vaultId,
    owner: b.owner,
    // As signed, for the same reason as the branch above.
    displayName: b.displayName ?? handle.value,
    bio: b.bio ?? '',
    coinType: b.coinType,
  });

  return NextResponse.json({ handle: slug });
}

/** `0x2::sui::SUI` and its 64-hex spelling are one coin; compare with the address padded. */
function normaliseCoinType(coinType: string): string {
  const [pkg, ...rest] = coinType.trim().split('::');
  const hex = (pkg ?? '').replace(/^0x/i, '').padStart(64, '0').toLowerCase();
  return `0x${hex}::${rest.join('::')}`;
}
