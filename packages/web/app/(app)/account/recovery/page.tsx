// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Recovery, given somewhere to live.
 *
 * `AccountRecovery` was written, tested, documented — and rendered by nothing. Its own header
 * argues that an escape hatch nobody can reach is not an escape hatch but a paragraph in a source
 * file, and until this route existed it was describing itself. The component test passed the whole
 * time, because a component test proves the component works and never that anything mounts it.
 *
 * It is its own route rather than a section of a settings page because of what it does: it spends a
 * fresh Google-signed token to reveal the salt behind an address. That deserves a deliberate
 * navigation, not a scroll position.
 *
 * Wallet sessions render nothing here — the component returns `null` for them, because they have no
 * salt and never depended on this deployment for anything.
 */

import { AccountRecovery } from '@/components/AccountRecovery';
import { PageHead } from '@/components/design/PageHead';

export const metadata = {
  // The root layout's template appends "· Weir".
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
        title="The salt behind your address, and how to"
        accent="keep it."
        lede="A zkLogin address is derived from your Google account and a salt this site holds. Take a copy and the address stays reachable even if this site does not. A wallet session has nothing here — it already holds its own keys."
      />
      <AccountRecovery />
    </>
  );
}
