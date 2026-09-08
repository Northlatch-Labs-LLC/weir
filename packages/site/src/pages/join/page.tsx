import { useNavigate } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import Sill from '@/components/base/Sill';
import { useViewer } from '@/lib/viewer-context';
import Icon from '@/components/base/Icon';

export default function Join() {
  const { signIn } = useViewer();
  const navigate = useNavigate();

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            An account costs you no email. A key.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            There is no email, no phone number, no password to recover. An account is a keypair.
            The key lives on your device and it is the only thing that can open your vault or sign
            as you. If you lose it, weir cannot recover it, because we never had a copy.
          </p>
        </header>

        <Sill />

        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">What you give up.</h2>
          <ul className="mt-6 space-y-3 text-body text-ink-8">
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>A few minutes to generate a key and write down a backup.</li>
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>The ability to click &quot;reset password&quot; when you forget. There is no such button here.</li>
          </ul>
        </section>

        <Sill />

        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">What you keep.</h2>
          <ul className="mt-6 space-y-3 text-body text-ink-8">
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>Control of your money. The vault opens only with your key.</li>
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>Control of your identity. You are a keypair, not an account record we can suspend.</li>
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>A real share of what you earn. The 2.9% is taken once, in the transaction.</li>
          </ul>
        </section>

        <Sill />

        <section className="py-12">
          <button
            type="button"
            onClick={() => { signIn(); navigate('/vault'); }}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-mint px-6 py-3 text-body font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
          >
            <Icon name="plus" size={18} />
            Create account
          </button>
        </section>
      </div>
    </Shell>
  );
}