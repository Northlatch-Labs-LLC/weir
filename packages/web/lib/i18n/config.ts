// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export const locales = ['en', 'ro'] as const;
export const defaultLocale = 'en' as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  ro: 'Română',
};

export const localeDateLocales: Record<Locale, string> = {
  en: 'en-GB',
  ro: 'ro-RO',
};

export const localeCurrency: Record<Locale, string> = {
  en: 'USD',
  ro: 'RON',
};

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

export function getLocaleFromPath(pathname: string): Locale | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  return isValidLocale(first) ? first : null;
}