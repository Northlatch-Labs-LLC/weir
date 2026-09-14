// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { PageHead } from '@/components/app/PageHead';
import { SigninPanel } from '@/components/app/SigninPanel';

/* The router puts this door inside the public shell; the page brings only its own head and body. */
export function SigninScreen({ nextPath }: { nextPath: string }) {
  return (
    <div className="w-doc">
      <PageHead
        title="Welcome"
        accent="back."
        lede="Sign in with Google or connect your wallet — whichever you used before. Nothing to remember, nothing to reset."
      />
      <SigninPanel nextPath={nextPath} />
    </div>
  );
}
