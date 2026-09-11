// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import assert from 'node:assert/strict';
import { agentFromReading, capabilitiesOf, StartupRefusal, type WeirPort } from '../src/transport.js';

let checks = 0;
let failures = 0;
function check(what: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`  ok  ${what}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${what}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

const agent: WeirPort = {
  quote: async () => ({ vaultId: '0x1', contentKey: 'k', priceMist: '1', coinType: '0x2::sui::SUI' }) as never,
};

function main(): void {
  check('unwraps a success to the agent itself, not the envelope', () => {
    const port = agentFromReading({ ok: true, value: agent });
    assert.equal(typeof port.quote, 'function', 'the bound port has no methods');
  });

  check('the unwrapped agent reports its capabilities', () => {
    const port = agentFromReading({ ok: true, value: agent });
    const caps = capabilitiesOf({ port, signer: { kind: 'none' }, policyAvailable: false } as never);
    assert.ok(caps.has('quote'), 'a bound agent reported no capabilities');
  });

  check('binding the ENVELOPE would report none — the defect, stated', () => {
    const envelope = { ok: true, value: agent } as unknown as WeirPort;
    const caps = capabilitiesOf({ port: envelope, signer: { kind: 'none' }, policyAvailable: false } as never);
    assert.equal(caps.size, 0, 'the envelope somehow reported a capability');
  });

  check('a refusal is refused, not bound as an empty server', () => {
    assert.throws(
      () => agentFromReading({ ok: false, failure: { kind: 'malformed', detail: 'bad manifest' } }),
      StartupRefusal,
    );
  });

  check('the refusal carries the reason the agent gave', () => {
    try {
      agentFromReading({ ok: false, failure: { kind: 'malformed', detail: 'bad manifest' } });
      assert.fail('expected a refusal');
    } catch (error) {
      assert.ok(
        error instanceof Error && error.message.includes('bad manifest'),
        'the operator is told a refusal happened but not why',
      );
    }
  });

  check('a refusal with no detail still refuses', () => {
    assert.throws(() => agentFromReading({ ok: false }), StartupRefusal);
  });

  for (const [name, value] of [
    ['a bare object', {}],
    ['null', null],
    ['a string', 'agent'],
    ['an agent passed unwrapped by mistake', agent],
  ] as const) {
    check(`refuses ${name} rather than binding it`, () => {
      assert.throws(() => agentFromReading(value), StartupRefusal);
    });
  }

  console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main();
