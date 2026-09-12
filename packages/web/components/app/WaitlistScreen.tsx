// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { PageHead } from '@/components/app/PageHead';
import { WaitlistPanel } from '@/components/app/WaitlistPanel';
import type { FunnelSides } from '@/components/app/ExploreFunnel';

/* The router puts this door inside the public shell; the page brings only its own head and body. */
export function WaitlistScreen({
  gated,
  total,
  launchTarget,
  funnel,
}: {
  gated: boolean;
  total: number | null;
  launchTarget: { atMs: number; label: string } | null;
  funnel: FunnelSides | null;
}) {
  return (
    <div className="w-doc">
      <PageHead
        title={gated ? 'Weir is in closed alpha.' : 'Weir is open.'}
        lede={
          gated
            ? 'Creators are onboarding now, by invitation. Leave your email and we will send one message when the doors open.'
            : 'Creator pages are open. Claim a handle now, or leave your email and we will tell you when something new ships.'
        }
      />
      <WaitlistPanel gated={gated} total={total} launchTarget={launchTarget} funnel={funnel} />
    </div>
  );
}
