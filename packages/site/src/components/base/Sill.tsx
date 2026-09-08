import type { ReactNode } from 'react';

// The one visual expression of the metaphor: a 1px #1c3d47 rule that content
// crosses. The rule is indented 24px so the first line of what follows
// overhangs its left end — the page passes over the barrier, not boxed by it.
export default function Sill({ children }: { children?: ReactNode }) {
  return (
    <div aria-hidden={!children}>
      <div className="sill-rule" />
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}