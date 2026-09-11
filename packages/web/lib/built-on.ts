// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export interface BuiltOn {
  name: string;
  mark: string;
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
