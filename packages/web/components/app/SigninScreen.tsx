// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { PageHead } from '@/components/app/PageHead';
import { SigninPanel } from '@/components/app/SigninPanel';

/* The router puts this door inside the public shell; the page brings only its own head and body. */
export function SigninScreen({ nextPath }: { nextPath: string }) {
  return (
    <div className="w-doc">
      <PageHead
        title="Sign in, and the"
        accent="address is yours."
        lede="Either path ends the same way: a real Sui address, and your keys are what sign for it. Nothing to remember, nothing to reset."
      />
      <SigninPanel nextPath={nextPath} />
    </div>
  );
}
