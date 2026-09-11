// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { Geist, Geist_Mono, Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';

export const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-serif',
});

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
