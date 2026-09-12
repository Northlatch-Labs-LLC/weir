// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * The shapes a creator page assembles before it hands anything to a screen.
 *
 * These describe data, not a rendering. They live here rather than beside a component because
 * both the route that builds them and the screen that reads them are free to change without the
 * other, and because neither design system owns them.
 */

import type { ReactNode } from 'react';

export interface CreatorTier {
  price: string;
  cadence: string;
  net: string;
  action: ReactNode;
  held: boolean;
}

export interface CreatorStat {
  label: string;
  value: string;
  note: string;
  font: string;
  size: string;
  style: string;
  color: string;
}
