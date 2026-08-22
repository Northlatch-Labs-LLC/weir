// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The mono face is not decoration. Every on-chain value — an object id, a basis-point figure, a
 * MIST amount — is DATA, and setting data in the body face makes it look like prose. Its figures
 * are tabular, which is what lets a changed amount read as a changed digit rather than as text of a
 * different width.
 */

import { Geist, Geist_Mono } from 'next/font/google';

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
