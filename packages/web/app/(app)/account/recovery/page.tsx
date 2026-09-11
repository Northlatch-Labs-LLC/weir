// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { AccountRecovery } from '@/components/AccountRecovery';
import { PageHead } from '@/components/design/PageHead';

export const metadata = {
  title: 'Recovery details',
};

export default function RecoveryPage() {
  return (
    <>
      {/*
        Chrome from `AppFrame`; `PageHead` restores the `h1` the retired title bar used to supply.

        The head renders for a wallet session too, where `AccountRecovery` returns null. That is
        correct rather than an empty page: a wallet holds its own keys and never depended on this
        deployment for anything, and the lede says so. A page that rendered nothing at all would
        read as broken to exactly the person for whom there is genuinely nothing to do.
      */}
      <PageHead
        kicker="Your account"
        title="Recovery"
        lede="A zkLogin address is derived from your Google account and a salt this site holds. Take a copy and the address stays reachable even if this site does not. A wallet session has nothing here — it already holds its own keys."
      />
      <AccountRecovery />
    </>
  );
}
