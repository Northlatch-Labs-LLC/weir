// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The deployment record must not contradict itself.
//
// `status.outstanding[0]` asserted "both governing caps are behind the 2-of-3 multisig … platform
// governance is cold" while `capabilities.custody` in the SAME FILE recorded PlatformCap on the
// publisher address, and the chain agreed with custody. Two claims, one file, opposite meanings —
// and this is the file somebody opens during an incident.
//
// Nothing caught it because nothing compared them. This does.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const record = JSON.parse(
  readFileSync(join(process.cwd(), '../../sui-contracts/deploy/mainnet.json'), 'utf8'),
) as {
  capabilities?: { custody?: { platformCapOwner?: string; upgradeCapOwner?: string } };
  status?: { outstanding?: string[] };
};

const custody = record.capabilities?.custody;
const prose = (record.status?.outstanding ?? []).join('\n');

describe('the deployment record agrees with itself', () => {
  it('records an owner for each governing capability', () => {
    expect(custody?.platformCapOwner).toMatch(/^0x[0-9a-f]{64}$/);
    expect(custody?.upgradeCapOwner).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('does not describe platform governance as cold while custody puts it on a single address', () => {
    /*
      The two owners differ today: upgrades are cold, governance is hot by choice. So any sentence
      claiming BOTH caps are behind the multisig is false. The check is on the assertion, not on the
      words — the corrected entry quotes the old claim in order to retract it, and quoting it must
      stay allowed or the correction could not be written down.
    */
    const sameCustodian = custody?.platformCapOwner === custody?.upgradeCapOwner;
    const claimsBothCold = /both governing caps are behind the .*multisig/i.test(prose);
    if (!sameCustodian) {
      expect(
        claimsBothCold,
        'the record asserts both caps are behind the multisig, but custody gives them different owners',
      ).toBe(false);
    }
  });

  it('names the address that actually holds PlatformCap in the prose, so a reader is not sent to the wrong one', () => {
    const owner = custody?.platformCapOwner ?? '';
    expect(prose).toContain(owner.slice(0, 10));
  });
});
