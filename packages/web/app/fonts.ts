// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The mono face is not decoration. Every on-chain value — an object id, a basis-point figure, a
 * MIST amount — is DATA, and setting data in the body face makes it look like prose. Its figures
 * are tabular, which is what lets a changed amount read as a changed digit rather than as text of a
 * different width.
 */

/**
 * The three faces the ported design is drawn in.
 *
 * Served from this origin through `next/font`, so there is no third-party request before first
 * paint and no reflow when a face arrives. `Geist` stays because the estate layer still names it.
 */

import { Geist, Geist_Mono, Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';

/** The interface. */
export const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

/** Prose: titles, posts, anything a person reads rather than operates. */
export const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-serif',
});

/** Data: addresses, object ids, amounts. Tabular figures, so a changed amount reads as a digit. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist',
});

export const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
});
