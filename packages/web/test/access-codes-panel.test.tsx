// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccessCodesPanel } from '../components/AccessCodesPanel';

describe('AccessCodesPanel', () => {
  it('says the list is loading, rather than showing an empty list', () => {
    render(<AccessCodesPanel initial={null} />);
    expect(screen.getByText(/Your codes are loading/)).toBeTruthy();
    expect(screen.queryByText(/No codes yet/)).toBeNull();
    expect(screen.queryByText(/No codes yet/)).toBeNull();
  });

  it('says the list was read and is empty when it is', () => {
    render(<AccessCodesPanel initial={[]} />);
    expect(screen.getByText(/No codes yet\. Mint one and share it/)).toBeTruthy();
  });

  it('lists a code with its uses and status', () => {
    render(
      <AccessCodesPanel
        initial={[{ code: 'ABCD-EFGH-JKLM', label: 'Ada', maxUses: 3, uses: 1, expiresAtMs: null, createdBy: '0xa', createdAtMs: 0, revokedAtMs: null }]}
      />,
    );
    expect(screen.getByText('ABCD-EFGH-JKLM')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('live')).toBeTruthy();
  });
});
