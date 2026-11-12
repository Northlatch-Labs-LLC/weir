// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { localeDateLocales, localeCurrency, type Locale } from './config';

export function getDateLocale(locale: Locale): string {
  return localeDateLocales[locale];
}

export function getCurrencyCode(locale: Locale): string {
  return localeCurrency[locale];
}

export function formatDate(
  date: Date | number | string,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(localeDateLocales[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(dateObj);
}

export function formatNumber(
  value: number | bigint,
  locale: Locale,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(localeDateLocales[locale], options).format(
    typeof value === 'bigint' ? Number(value) : value
  );
}

export function formatCurrency(
  value: number | bigint,
  locale: Locale,
  currency?: string,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(localeDateLocales[locale], {
    style: 'currency',
    currency: currency || localeCurrency[locale],
    ...options,
  }).format(typeof value === 'bigint' ? Number(value) : value);
}

export function formatCompactNumber(
  value: number | bigint,
  locale: Locale
): string {
  return new Intl.NumberFormat(localeDateLocales[locale], {
    notation: 'compact',
    compactDisplay: 'short',
  }).format(typeof value === 'bigint' ? Number(value) : value);
}

export function formatPercent(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(localeDateLocales[locale], {
    style: 'percent',
    ...options,
  }).format(value);
}

export function formatUnits(
  amount: bigint,
  decimals: number,
  locale: Locale
): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString();
  const frac = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  const formattedWhole = formatNumber(BigInt(whole), locale);
  return `${negative ? '-' : ''}${formattedWhole}${frac === '' ? '' : `.${frac}`}`;
}

export function formatSui(mist: bigint | string, locale: Locale): string {
  return formatUnits(BigInt(mist), 9, locale);
}

export function formatUsdc(microUsdc: bigint | string, locale: Locale): string {
  return formatUnits(BigInt(microUsdc), 6, locale);
}

// These functions require translation messages, so they accept the messages as a parameter
export function formatRelativeTime(
  date: Date | number | string,
  locale: Locale,
  timeMessages: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string; weeksAgo: string; monthsAgo: string; yearsAgo: string }
): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSecs < 60) return timeMessages.justNow;
  if (diffMins < 60) return timeMessages.minutesAgo.replace('{count}', diffMins.toString());
  if (diffHours < 24) return timeMessages.hoursAgo.replace('{count}', diffHours.toString());
  if (diffDays < 7) return timeMessages.daysAgo.replace('{count}', diffDays.toString());
  if (diffWeeks < 4) return timeMessages.weeksAgo.replace('{count}', diffWeeks.toString());
  if (diffMonths < 12) return timeMessages.monthsAgo.replace('{count}', diffMonths.toString());
  return timeMessages.yearsAgo.replace('{count}', diffYears.toString());
}

export function formatPeriod(
  periodMs: bigint | string,
  locale: Locale,
  unitMessages: { day: string; days: string; hour: string; hours: string; minute: string; minutes: string }
): string {
  const total = BigInt(periodMs);
  const DAY_MS = 86_400_000n;
  const HOUR_MS = 3_600_000n;
  const MINUTE_MS = 60_000n;

  const days = total / DAY_MS;
  const hours = (total % DAY_MS) / HOUR_MS;
  const minutes = (total % HOUR_MS) / MINUTE_MS;

  const parts: string[] = [];
  if (days > 0n) parts.push(`${days} ${days === 1n ? unitMessages.day : unitMessages.days}`);
  if (hours > 0n) parts.push(`${hours} ${hours === 1n ? unitMessages.hour : unitMessages.hours}`);
  if (minutes > 0n && days === 0n) parts.push(`${minutes} ${minutes === 1n ? unitMessages.minute : unitMessages.minutes}`);
  return parts.length === 0 ? 'less than a minute' : parts.join(' ');
}