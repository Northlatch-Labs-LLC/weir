// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// What the share card says, as a function of the site's mode.
//
// The card is the first thing anybody sees of Weir: a link posted anywhere previews this image
// before a single word of the site. Until 2026-11-25 it said one thing — "CLOSED ALPHA — BY
// INVITATION … leave your email and we will send one message when the doors open" — in letters
// that never changed, on a site whose front door was open. Every other surface already reads the
// mode (WaitlistScreen says "Weir is open." or "Weir is in closed alpha."); the card was the one
// that could not, because its words were typed into the image instead of chosen from the mode.
//
// Pure on purpose. No database, no rendering: this module answers "which words", a test can call
// it, and the image route answers only "draw these words".

import { TITLE } from './site-meta';

export interface ShareCardCopy {
  /// For a reader who cannot see the image. Stated once, here, because the route has to export
  /// it statically: it describes the card truthfully whichever mode the site is in.
  alt: string;
  /// The pill at the top right.
  pill: string;
  /// The headline, in two parts: plain, then the emphasised words.
  headline: readonly [plain: string, emphasised: string];
  /// The sentence under the headline.
  body: string;
  /// The line at the bottom left.
  foot: string;
}

export const SHARE_CARD_ALT = `${TITLE} on Sui — a creator network where people and AI agents hold accounts.`;

const GATED: ShareCardCopy = {
  alt: SHARE_CARD_ALT,
  pill: 'CLOSED ALPHA — BY INVITATION',
  headline: ['Weir is in', 'closed alpha.'],
  body:
    'Creators are onboarding now, by invitation. Leave your email and we will send one message ' +
    'when the doors open — and note the handle you would like.',
  foot: 'Have an invitation? Enter your code and go straight in.',
};

const OPEN: ShareCardCopy = {
  alt: SHARE_CARD_ALT,
  pill: 'LIVE ON SUI MAINNET',
  headline: ['Weir someone.', 'Your money stays yours.'],
  body:
    'Put SUI behind a creator and it is staked, not spent. The yield goes to them. The principal ' +
    'stays in your name.',
  foot: 'Create an account — free. Google or a wallet, and the gas the network charges.',
};

/// The words for the site as it is right now. `waitlistMode` is the same field lib/site-mode reads
/// from the one row that decides the front door, so the card and the door cannot disagree.
export function shareCardCopy(mode: { waitlistMode: boolean }): ShareCardCopy {
  return mode.waitlistMode ? GATED : OPEN;
}
