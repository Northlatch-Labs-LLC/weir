// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * What this product runs on, and what each piece actually does for a reader.
 *
 * # Why this moved out of the footer
 *
 * It was defined inside `components/shell/SiteFooter.tsx` and rendered as one of six footer
 * columns — five partner logos beside the legal links, on every page, which is where a mark goes
 * to be ignored. It now lives on `/security`, the page that exists to answer "what is this built
 * on", at a size where the notes can be read.
 *
 * Kept as data in `lib/` rather than inside whichever component happens to draw it, so a second
 * surface can list it without copying it, and so removing a rendering never deletes the list.
 *
 * The marks are the partners' own files from `public/brand/built-on/`. `mark` is the fallback for
 * a partner who supplies no file, and is a letter, not an emoji.
 */

export interface BuiltOn {
  name: string;
  /** Letter fallback, used when there is no logo file. */
  mark: string;
  /** One line, from the reader's side: what this piece does for them, not what it is. */
  note: string;
  href: string;
  logo?: string;
}

export const BUILT_ON: readonly BuiltOn[] = [
  { name: 'Sui', mark: 'S', note: 'Where payments settle', href: 'https://sui.io', logo: '/brand/built-on/sui-icon.png' },
  { name: 'Walrus', mark: 'W', note: 'Where posts and pictures are stored', href: 'https://www.walrus.xyz', logo: '/brand/built-on/walrus-icon.png' },
  { name: 'Seal', mark: 'SL', note: 'Holds the key to anything you paid for', href: 'https://seal-docs.wal.app', logo: '/brand/built-on/seal-icon.png' },
  { name: 'zkLogin', mark: 'zk', note: 'Lets you sign in with Google', href: 'https://docs.sui.io/concepts/cryptography/zklogin', logo: '/brand/built-on/zklogin-icon.png' },
  { name: 'USDC', mark: '$', note: 'One of the two coins you can pay in', href: 'https://www.circle.com/usdc' },
];
