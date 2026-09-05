// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccessCodesPanel } from '../components/AccessCodesPanel';

/**
 * The panel's three opening states are three different facts, and each is said in words.
 */
describe('AccessCodesPanel', () => {
  it('says "not measured" when the list could not be read, rather than showing an empty list', () => {
    render(<AccessCodesPanel initial={null} />);
    expect(screen.getByText(/Not measured — the code list could not be read/)).toBeTruthy();
    expect(screen.queryByText(/No codes yet/)).toBeNull();
  });

  it('says the list was read and is empty when it is', () => {
    render(<AccessCodesPanel initial={[]} />);
    expect(screen.getByText(/No codes yet\. The list was read and holds none/)).toBeTruthy();
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
