// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import Link from 'next/link';
import { PageHead } from '@/components/design/PageHead';
import { PRIMARY } from '@/lib/site-map';

export default function NotFound() {
  return (
    <>
      <PageHead
              centered
        kicker="Not found"
        title="There is nothing at"
        accent="this address."
        lede="The link may be old, or the page may have moved. Everything that exists is one of these."
      />
      <ul className="nf-list">
        {PRIMARY.map((d) => (
          <li key={d.href}>
            <Link href={d.href} className="nf-link">
              <span className="nf-link__label">{d.label}</span>
              {d.blurb !== undefined && <span className="nf-link__blurb">{d.blurb}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
