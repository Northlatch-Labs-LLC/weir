// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import assert from 'node:assert/strict';
import { loadPolicyDoc, resolveOptions, ENV } from '../src/transport.js';

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

const ME = `0x${'f'.repeat(64)}`;
const doc = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    agentAddress: ME,
    outflowCeilings: [],
    allowedTargets: [],
    allowedTypeArguments: [],
    allowedRecipients: [],
    allowedObjects: [],
    maxGasBudgetMist: '10000000',
    ...over,
  });

function main(): void {
  check('a well-formed document for this signer is accepted', () => {
    const r = loadPolicyDoc(doc(), ME);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  check("another agent's policy is refused, however the address is written", () => {
    const r = loadPolicyDoc(doc({ agentAddress: `0x${'e'.repeat(64)}` }), ME);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /different agentAddress/);
    // The same address in another hand. Case carries no meaning in the hex, and leading zeroes are
    // written or left out at will, so both of these name this signer and its own policy is not
    // refused for the spelling.
    assert.equal(loadPolicyDoc(doc({ agentAddress: `0x${'F'.repeat(64)}` }), ME).ok, true);
    const short = '0x2f8e7e447d69d9fff9e38f91b05927212f990c8588f46386e795d8c42cfb9d8c';
    assert.equal(loadPolicyDoc(doc({ agentAddress: short }), `0x${short.slice(2).padStart(64, '0')}`).ok, true);
    // Different bytes stay different, however they are padded.
    assert.equal(loadPolicyDoc(doc({ agentAddress: `0x02f8${short.slice(4)}` }), short).ok, false);
    // The 0x is the prefix, not a digit: 0X… is not an address, and a value that is not an address
    // at all is refused rather than compared.
    assert.equal(loadPolicyDoc(doc({ agentAddress: ME.toUpperCase() }), ME).ok, false);
    assert.equal(loadPolicyDoc(doc({ agentAddress: 'not-an-address' }), ME).ok, false);
    assert.equal(loadPolicyDoc(doc({ agentAddress: 42 }), ME).ok, false);
  });
  check('a document of another version, or missing a list, or not JSON, is refused with the reason', () => {
    assert.match((loadPolicyDoc(doc({ version: 2 }), ME) as { reason: string }).reason, /version/);
    assert.match((loadPolicyDoc(doc({ allowedObjects: undefined }), ME) as { reason: string }).reason, /allowedObjects/);
    assert.match((loadPolicyDoc('not json', ME) as { reason: string }).reason, /not JSON/);
  });
  check('outflowCeilings entry with wildcard coinType is refused', () => {
    const r = loadPolicyDoc(doc({ outflowCeilings: [{ coinType: '*', maxPerPeriod: '1000000', periodMs: 86400000 }] }), ME);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /coinType/);
  });
  check('outflowCeilings entry with empty coinType is refused', () => {
    const r = loadPolicyDoc(doc({ outflowCeilings: [{ coinType: '', maxPerPeriod: '1000000', periodMs: 86400000 }] }), ME);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /coinType/);
  });
  check('outflowCeilings entry missing maxPerPeriod is refused', () => {
    const r = loadPolicyDoc(doc({ outflowCeilings: [{ coinType: '0x2::sui::SUI', periodMs: 86400000 }] }), ME);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /maxPerPeriod/);
  });
  check('outflowCeilings entry with non-integer periodMs is refused', () => {
    const r = loadPolicyDoc(doc({ outflowCeilings: [{ coinType: '0x2::sui::SUI', maxPerPeriod: '1000000', periodMs: -1 }] }), ME);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /periodMs/);
  });
  check('outflowCeilings entry that is not an object is refused', () => {
    const r = loadPolicyDoc(doc({ outflowCeilings: ['not-an-object'] }), ME);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /not an object/);
  });
  check('well-formed outflowCeilings entry is accepted', () => {
    const r = loadPolicyDoc(doc({ outflowCeilings: [{ coinType: '0x2::sui::SUI', maxPerPeriod: '10000000', periodMs: 86400000 }] }), ME);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  check('WEIR_AGENT_POLICY is read only in stdio mode with a key, never under --http', () => {
    const base = { WEIR_BASE_URL: 'https://weir.social', PROJECTX_SOCIAL_NETWORK: 'mainnet' } as Record<string, string>;
    const http = resolveOptions(['--http'], { ...base, [ENV.policy]: '/tmp/policy.json' });
    assert.equal(http.policyPath, null);
    const stdioNoKey = resolveOptions(['--stdio'], { ...base, [ENV.policy]: '/tmp/policy.json' });
    assert.equal(stdioNoKey.policyPath, null);
  });

  console.log(`\n${checks} checks, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main();
