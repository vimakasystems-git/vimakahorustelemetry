import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { BackendError } from '../src/prometheus.js';
const token = 'a'.repeat(64);
const headers = { Authorization: `Bearer ${token}` };
const vector = (value, metric = {}) => [{ metric, value: [100, String(value)] }];
const fake = { query: async q => q.includes('sum by (service_name)') ? vector(100, { service_name: 'horus-api' }) : q.includes('sum by (client, server)') ? vector(2, { client: 'frontend', server: 'horus-api' }) : q.includes('histogram_quantile') ? vector(0.8) : q.includes('status_code=') ? vector(10) : vector(1000) };
async function start(t, options = {}) {
  const server = createApp({ client: fake, token, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return (path, opts = {}) => fetch(`${url}${path}`, { headers, ...opts });
}
test('health is live; protected inventory needs token', async t => {
  const get = await start(t);
  assert.equal((await get('/health', { headers: {} })).status, 200);
  assert.equal((await get('/api/v1/services', { headers: {} })).status, 401);
  assert.equal((await get('/api/v1/services', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
});
test('authentication failure never queries backend', async t => {
  let called = false;
  const get = await start(t, { client: { query: async () => { called = true; return []; } } });
  await get('/api/v1/services', { headers: {} }); assert.equal(called, false);
});
test('inventory and topology are populated from actual provider results', async t => {
  const get = await start(t);
  const inventory = await (await get('/api/v1/services')).json();
  assert.deepEqual(inventory.services, [{ name: 'horus-api', requests: 100 }]);
  const graph = await (await get('/api/v1/topology')).json();
  assert.deepEqual(graph.edges, [{ from: 'frontend', to: 'horus-api', requestsPerSecond: 2 }]);
});
test('diagnostic report has three evidence queries at one instant', async t => {
  const get = await start(t);
  const r = await (await get('/api/v1/diagnostics?service=horus-api')).json();
  assert.equal(r.slo.status, 'breached'); assert.equal(r.findings.length, 2);
  assert.equal(r.rootCause, null); assert.equal(new Set(r.evidence.map(e => e.queriedAt)).size, 1);
});
test('empty upstream results stay no_data', async t => {
  const get = await start(t, { client: { query: async () => [] } });
  assert.equal((await (await get('/api/v1/services')).json()).status, 'no_data');
  assert.equal((await (await get('/api/v1/slo?service=none')).json()).slo.status, 'no_data');
});
test('invalid error sample is not interpreted as zero errors', async t => {
  const get = await start(t, { client: { query: async q => q.includes('status_code=') ? vector('NaN') : vector(100) } });
  assert.equal((await get('/api/v1/slo?service=horus-api')).status, 503);
});
test('backend failure is 503 and health remains available', async t => {
  const get = await start(t, { client: { query: async () => { throw new BackendError('secret'); } } });
  const r = await get('/api/v1/services'); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'backend_unavailable');
  assert.equal((await get('/health')).status, 200); assert.equal((await get('/ready')).status, 503);
});
test('malicious or missing service parameters are rejected', async t => {
  const get = await start(t);
  assert.equal((await get('/api/v1/slo')).status, 400);
  assert.equal((await get('/api/v1/slo?service=x%22%7D')).status, 400);
  assert.equal((await get('/api/v1/services?window=100y')).status, 400);
});
test('demo endpoints require explicit opt-in', async t => {
  const get = await start(t); assert.equal((await get('/demo/error')).status, 404);
  const demo = await start(t, { enableDemo: true }); assert.equal((await demo('/demo/error')).status, 500);
  assert.equal((await demo('/demo/latency')).status, 200);
});
test('static assets have CSP and no arbitrary filesystem exposure', async t => {
  const get = await start(t);
  const r = await get('/'); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await r.text(), /Vimaka Telemetry/);
  assert.equal((await get('/.env')).status, 404);
  assert.equal((await get('/%2e%2e/package.json')).status, 404);
  assert.equal((await get('/api/v1/services', { method: 'POST' })).status, 405);
});
test('token rate limit does not affect liveness', async t => {
  const get = await start(t, { maxRequestsPerMinute: 1 });
  assert.equal((await get('/api/v1/services')).status, 200);
  assert.equal((await get('/api/v1/services')).status, 429);
  assert.equal((await get('/health')).status, 200);
});
test('missing or placeholder credentials fail closed', () => {
  for (const value of [undefined, '', 'short', 'replace-with-a-real-secret-at-least-32']) assert.throws(() => createApp({ client: fake, token: value }));
});
