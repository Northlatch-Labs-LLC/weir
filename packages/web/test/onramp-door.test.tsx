// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The card door opens a tab, and only a tab.
 *
 * These assertions exist because of one live defect: the door was opened with
 * `window.open('', '_blank', 'noopener')`. That feature string makes `window.open` return null by
 * specification even though the tab is created, the null was read as "popup blocked", and the
 * fallback navigated the current page. Every press therefore left a blank tab behind and took the
 * person off the page they were funding.
 *
 * So the shape of the call is pinned, not just its effect — the effect looked identical to a
 * deliberate redirect, which is why it survived a manual check.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { AddFundsButton } = await import('../components/AddFundsButton');

const ADDRESS = '0x8539945639191e1749b60c1cd56ada185569b69b1ca7a9e5d6c7915d60c06084';
const WIDGET = 'https://global-stg.transak.com/?apiKey=k&sessionId=abc';

/** A stand-in for the tab the browser hands back. Records where it was pointed. */
function fakeTab() {
  return { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
}

function mockSession(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => ({ ok: status === 200, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let here: string;

beforeEach(() => {
  here = window.location.href;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the card door', () => {
  it('never passes noopener, because that would cost it the tab', async () => {
    const tab = fakeTab();
    const openMock = vi.fn((_url?: string, _target?: string, _features?: string) => tab);
    vi.stubGlobal('open', openMock);
    mockSession({ widgetUrl: WIDGET });

    render(<AddFundsButton walletAddress={ADDRESS} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(openMock).toHaveBeenCalled());
    const features = openMock.mock.calls[0]?.[2];
    expect(features).toBeUndefined();
    expect(JSON.stringify(openMock.mock.calls[0])).not.toContain('noopener');
  });

  it('claims the tab synchronously, then points it at the widget', async () => {
    // Synchronously: a popup opened after an await is no longer attributable to the click, and
    // browsers block it.
    const tab = fakeTab();
    const openMock = vi.fn((_url?: string, _target?: string, _features?: string) => tab);
    vi.stubGlobal('open', openMock);
    mockSession({ widgetUrl: WIDGET });

    render(<AddFundsButton walletAddress={ADDRESS} />);
    fireEvent.click(screen.getByRole('button'));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock.mock.calls[0]?.[0]).toBe('');
    expect(openMock.mock.calls[0]?.[1]).toBe('_blank');

    await waitFor(() => expect(tab.location.href).toBe(WIDGET));
    // The page the supporter was standing on is the page they come back to.
    expect(window.location.href).toBe(here);
  });

  it('disowns the tab it opened', async () => {
    // The opener relationship is severed from this side instead of by the feature string, so the
    // payment page cannot navigate ours through `window.opener`.
    const tab = fakeTab();
    vi.stubGlobal('open', vi.fn(() => tab));
    mockSession({ widgetUrl: WIDGET });

    render(<AddFundsButton walletAddress={ADDRESS} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(tab.location.href).toBe(WIDGET));
    expect(tab.opener).toBeNull();
  });

  it('offers a link when the browser really did block the tab', async () => {
    // Now that `noopener` is gone, a null return means what it says. It is answered with something
    // the person clicks — never by navigating this page out from under them.
    vi.stubGlobal('open', vi.fn(() => null));
    mockSession({ widgetUrl: WIDGET });

    render(<AddFundsButton walletAddress={ADDRESS} />);
    fireEvent.click(screen.getByRole('button'));

    const link = await screen.findByRole('link', { name: /open the payment page/i });
    expect(link.getAttribute('href')).toBe(WIDGET);
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(window.location.href).toBe(here);
  });

  it('closes the empty tab and says why when the session is refused', async () => {
    // A blank tab left open next to a silent button is how somebody concludes the site is broken
    // rather than unconfigured.
    const tab = fakeTab();
    vi.stubGlobal('open', vi.fn(() => tab));
    mockSession({ error: 'TRANSAK_API_KEY is not set' }, 503);

    render(<AddFundsButton walletAddress={ADDRESS} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(await screen.findByText(/TRANSAK_API_KEY is not set/)).toBeTruthy();
    expect(tab.location.href).toBe('');
    expect(window.location.href).toBe(here);
  });
});
