// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { AccountRecovery } from '@/components/AccountRecovery';
import { PageHead } from '@/components/app/PageHead';

export const metadata = {
  title: 'Recovery details',
};

export default function RecoveryPage() {
  return (
    <>
      <PageHead
        kicker="Your account"
        title="Recovery"
        lede="A zkLogin address is derived from your Google account and a salt this site holds. Take a copy and the address stays reachable even if this site does not. A wallet session has nothing here — it already holds its own keys."
      />
      <AccountRecovery />
    </>
  );
}
