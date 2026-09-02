// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The operator's one button: it signs the operator statement over the agent's instant with the
  connected wallet and posts both halves. Nothing is typed, nothing is pasted.

  Mutations predicted: sign with Date.now() instead of the request's instant → "the operator half
  repeats the agent's instant" red; send the agent half from state the server did not give → the
  body assertion red; offer the button on an expired request → "an expired request has no button" red.
*/
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statementFor } from '@projectx-social/sdk';
import { OperatorDeclare, minutesLeft, type PendingRequest } from '../components/OperatorDeclare';

const OPERATOR = `0x${'9'.repeat(64)}`;
const AGENT = `0x${'1'.repeat(64)}`;

const signed: Uint8Array[] = [];
vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    signer: {
      address: OPERATOR,
      signPersonalMessage: async (bytes: Uint8Array) => {
        signed.push(bytes);
        return 'OPERATOR-SIG';
      },
    },
  }),
}));
vi.mock('@/components/SignInPrompt', () => ({ SignInPrompt: () => <div>sign in</div> }));

afterEach(() => {
  cleanup();
  signed.length = 0;
});

function fetchWith(requests: PendingRequest[], onDeclare: (body: unknown) => { status: number; body: unknown }) {
  const posts: unknown[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/agents/declare/pending')) return new Response(JSON.stringify({ requests, truncated: false }), { status: 200 });
    if (url === '/api/agents/declare') {
      const body = JSON.parse(String(init?.body)) as unknown;
      posts.push(body);
      const answer = onDeclare(body);
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, posts };
}

const request = (over: Partial<PendingRequest> = {}): PendingRequest => ({
  address: AGENT,
  operatorAddress: OPERATOR,
  model: 'claude',
  purpose: 'proves the button',
  issuedAtMs: Date.now() - 30_000,
  expiresAtMs: Date.now() + 570_000,
  agentSignature: 'AGENT-SIG',
  ...over,
});

describe('minutesLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(minutesLeft(100_000, 0)).toBe(2);
    expect(minutesLeft(60_000, 0)).toBe(1);
    expect(minutesLeft(0, 1)).toBe(0);
  });
});

describe('OperatorDeclare', () => {
  it('the operator half repeats the agent’s instant, and both halves are posted together', async () => {
    const req = request();
    const { fetchImpl, posts } = fetchWith([req], () => ({ status: 201, body: { agent: { address: AGENT } } }));
    const { findByText, container } = render(<OperatorDeclare fetchImpl={fetchImpl} />);
    const button = await findByText('I operate this agent — sign and file');
    fireEvent.click(button);
    await waitFor(() => expect(posts).toHaveLength(1));

    const expectedText = statementFor({ kind: 'declare-operator', agent: AGENT, model: req.model, purpose: req.purpose }, OPERATOR, req.issuedAtMs, window.location.origin);
    expect(new TextDecoder().decode(signed[0])).toBe(expectedText);
    expect(posts[0]).toEqual({
      address: AGENT,
      operatorAddress: OPERATOR,
      model: req.model,
      purpose: req.purpose,
      timestampMs: req.issuedAtMs,
      agentSignature: 'AGENT-SIG',
      operatorSignature: 'OPERATOR-SIG',
    });
    await waitFor(() => expect(container.querySelector('[data-filed="true"]')).not.toBeNull());
  });

  it('a refusal from the register is shown as the server’s sentence', async () => {
    const { fetchImpl } = fetchWith([request()], () => ({ status: 401, body: { error: "the operator's signature does not stand: nope" } }));
    const { findByText, container } = render(<OperatorDeclare fetchImpl={fetchImpl} />);
    fireEvent.click(await findByText('I operate this agent — sign and file'));
    await waitFor(() => expect(container.querySelector('[data-refused="true"]')?.textContent).toContain('does not stand'));
  });

  it('an expired request has no live button', async () => {
    const { fetchImpl, posts } = fetchWith([request({ expiresAtMs: Date.now() - 1 })], () => ({ status: 201, body: {} }));
    const { findByText, container } = render(<OperatorDeclare fetchImpl={fetchImpl} />);
    await findByText(/expired/);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(posts).toHaveLength(0);
  });

  it('says plainly when nothing is waiting', async () => {
    const { fetchImpl } = fetchWith([], () => ({ status: 201, body: {} }));
    const { container } = render(<OperatorDeclare fetchImpl={fetchImpl} />);
    await waitFor(() => expect(container.querySelector('[data-empty="true"]')).not.toBeNull());
  });
});
