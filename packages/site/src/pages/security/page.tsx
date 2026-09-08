import Shell from '@/components/layout/Shell';
import Sill from '@/components/base/Sill';

export default function Security() {
  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            What we can do to you, and what we cannot.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            A list, written to be checked. Nothing here is a promise; it is the shape of the
            system. If the shape is wrong, the claim is wrong, and you can verify that on-chain.
          </p>
        </header>

        <Sill />

        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">What we cannot do.</h2>
          <ul className="mt-6 space-y-4 text-body text-ink-8">
            {[
              ['Move your coins', 'The contract has no method that transfers coins out of your vault. We cannot spend, freeze, or redirect what is yours.'],
              ['Hold your money', 'Payments settle directly from the buyer to your vault. We are not an account in between, so there is no balance of yours to hold.'],
              ['Read your locked posts', 'A paid post is ciphertext. The platform stores bytes it cannot decrypt. Your key is the only thing that opens it.'],
              ['Recover your key', 'We do not have a copy. If you lose your key, we cannot restore access, because there is nothing for us to restore.'],
              ['Change your earnings terms', 'The 2.9% is written into the transaction you sign. It cannot be quietly raised afterward.'],
            ].map(([t, b]) => (
              <li key={t} className="flex gap-3">
                <span className="font-mono text-mint">✕</span>
                <span><strong className="font-medium text-ink-10">{t}.</strong> {b}</span>
              </li>
            ))}
          </ul>
        </section>

        <Sill />

        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">What we can do.</h2>
          <ul className="mt-6 space-y-4 text-body text-ink-8">
            {[
              ['Take 2.9% in the transaction', 'A second transfer, signed by the buyer, in the same transaction. It is visible on the receipt and on the chain.'],
              ['Show or remove content', 'We run the interface. If a post breaks the terms, we can stop displaying it. We cannot touch the coins that already settled for it.'],
              ['Moderate the network', 'We can remove spam and abuse from what you see. That is a display decision, not a custody decision.'],
            ].map(([t, b]) => (
              <li key={t} className="flex gap-3">
                <span className="font-mono text-rose">✓</span>
                <span><strong className="font-medium text-ink-10">{t}.</strong> {b}</span>
              </li>
            ))}
          </ul>
        </section>

        <Sill />

        <section className="py-12">
          <p className="prose-body text-ink-8">
            The distinction that matters: we can decide what you see, but we cannot decide what
            happens to your money. One of those is a product. The other is custody. We do the
            first, and the structure makes the second impossible.
          </p>
        </section>
      </div>
    </Shell>
  );
}