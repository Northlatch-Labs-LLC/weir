// A single flag decides whether the client serves from mock fixtures or from a
// real HTTP backend. Swapping one for the other is one environment variable —
// no code change.
//
//   VITE_PUBLIC_API_BASE_URL unset  → mock fixtures (development)
//   VITE_PUBLIC_API_BASE_URL set    → real HTTP backend at that base URL

const rawBase = import.meta.env.VITE_PUBLIC_API_BASE_URL as string | undefined;

export const API_MODE: 'mock' | 'http' = rawBase ? 'http' : 'mock';

export const API_BASE = (rawBase ?? '').replace(/\/+$/, '');