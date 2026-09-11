// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';

export function PageHead({
  kicker,
  title,
  accent,
  lede,
  actions,
  centered = false,
}: {
  kicker?: string;
  title: string;
  accent?: string;
  lede: ReactNode;
  actions?: ReactNode;
  centered?: boolean;
}) {
  const heading = accent === undefined ? title : `${title} ${accent}`;
  const hasLede = lede !== undefined && lede !== null && lede !== '';

  return (
    <>
      <header className="w-phead">
        <h1 id="w-title" tabIndex={-1}>
          {heading}
        </h1>
        {actions === undefined ? null : <div className="w-phead__actions">{actions}</div>}
      </header>
      {hasLede ? <p className="w-phead__lede">{lede}</p> : null}
    </>
  );
}

export function PageSection({
  title,
  hint,
  actions,
  reveal = false,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  reveal?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="weir-section" aria-label={title} {...(reveal ? { 'data-reveal': '' } : {})}>
      <div className="weir-section__head">
        <div>
          <h2 className="weir-section__title">
            <span className="weir-grad">{title}</span>
          </h2>
          {hint !== undefined && <p className="weir-section__hint">{hint}</p>}
        </div>
        {actions !== undefined && <div className="weir-section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
