import test from 'node:test';
import assert from 'node:assert/strict';
import { parameters, queries, calculateSlo, diagnose, scalar } from '../src/domain.js';

test('default parameters and deterministic PromQL', () => {
  const p = parameters(new URLSearchParams('service=horus-api'));
  assert.deepEqual(p, { service: 'horus-api', window: '30m', target: 0.999 });
  assert.match(queries(p).total, /increase.*service_name="horus-api".*\[30m\]/);
  assert.match(queries(p).errors, /STATUS_CODE_ERROR/);
});
for (const input of ['service=x%22%7Dor%20vector(1)', 'service=', 'window=9999d', 'target=1', 'target=NaN', 'target=-1', 'target=']) {
  test(`rejects unsafe parameters: ${input}`, () => assert.throws(() => parameters(new URLSearchParams(input))));
}
test('empty or idle traffic is no_data, never 100% healthy', () => {
  for (const total of [null, 0]) {
    const r = calculateSlo(total, null, 0.999);
    assert.equal(r.status, 'no_data'); assert.equal(r.sli, null); assert.equal(r.burnRate, null);
  }
});
test('SLO computes budget, SLI and burn rate with fractional increase counts', () => {
  const r = calculateSlo(10000, 100, 0.999);
  assert.equal(r.status, 'breached'); assert.equal(r.sli, 0.99);
  assert.ok(Math.abs(r.burnRate - 10) < 1e-9);
  assert.ok(Math.abs(r.budgetRemaining + 90) < 1e-9);
  assert.equal(calculateSlo(1000.5, 0.2, 0.999).status, 'within_target');
});
test('an empty successful error query means no observed errors', () => {
  assert.equal(calculateSlo(100, null, 0.999).sli, 1);
});
test('inconsistent errors do not become an availability percentage', () => {
  for (const bad of [-1, Infinity, 11]) assert.equal(calculateSlo(10, bad, 0.999).status, 'inconsistent_data');
  assert.throws(() => calculateSlo(-1, 0, 0.999));
  assert.throws(() => calculateSlo(10, 0, 1));
});
test('NaN and missing samples are explicit null', () => {
  assert.equal(scalar([]), null); assert.equal(scalar([{ value: [1, 'NaN'] }]), null);
});
test('diagnostic findings cite only available evidence and do not invent a cause', () => {
  const d = diagnose({ slo: calculateSlo(1000, 100, 0.999), p95Seconds: 0.8, evidence: [{ id: 'total' }, { id: 'errors' }, { id: 'p95' }] });
  assert.equal(d.rootCause, null); assert.equal(d.automationEnabled, false);
  assert.equal(d.findings.length, 2);
  for (const f of d.findings) for (const id of f.evidence) assert.ok(d.evidence.some(e => e.id === id));
});
test('diagnostics flag insufficient coverage', () => {
  assert.equal(diagnose({ slo: calculateSlo(0, 0, 0.999), p95Seconds: null }).findings[0].type, 'coverage');
});
