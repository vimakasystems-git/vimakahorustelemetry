import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const env = Object.fromEntries((await readFile(new URL('../.env', import.meta.url), 'utf8')).split('\n').filter(line => line.includes('=') && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const headers = { Authorization: `Bearer ${env.HORUS_API_TOKEN}` };
const api = 'http://127.0.0.1:8080';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(url, options = {}) { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(4000) }); assert.ok(response.ok, `HTTP ${response.status} from ${new URL(url).pathname}`); return response.json(); }
async function eventually(name, run) {
  let last;
  for (let attempt = 0; attempt < 40; attempt++) { try { await run(); console.log(`PASS ${name}`); return; } catch (error) { last = error; await sleep(3000); } }
  throw new Error(`${name} failed: ${last?.message}`);
}
await eventually('API and Prometheus ready', () => json(`${api}/ready`, { headers }));
assert.equal((await fetch(`${api}/api/v1/services`)).status, 401);
for (let i = 0; i < 3; i++) {
  await json(`${api}/demo/latency`, { headers });
  assert.equal((await fetch(`${api}/demo/error`, { headers })).status, 500);
  await sleep(5500);
}
await eventually('SDK metrics reach Prometheus', async () => {
  const q = encodeURIComponent('horus_requests_total');
  const result = await json(`http://127.0.0.1:9090/api/v1/query?query=${q}`);
  assert.ok(result.data.result.length > 0);
});
await eventually('Collector span metrics reach Horus inventory', async () => {
  const result = await json(`${api}/api/v1/services`, { headers });
  assert.ok(result.services.some(s => s.name === 'horus-api' && s.requests > 0));
});
await eventually('SLO and diagnostic evidence are populated', async () => {
  const result = await json(`${api}/api/v1/diagnostics?service=horus-api`, { headers });
  assert.ok(result.slo.total > 0); assert.ok(result.slo.errors > 0);
  assert.ok(result.p95Seconds > 0); assert.equal(result.evidence.length, 3);
  assert.equal(result.rootCause, null); assert.equal(result.automationEnabled, false);
});
await eventually('Traces reach Tempo', async () => {
  const result = await json('http://127.0.0.1:3200/api/search');
  assert.ok(result.traces?.some(t => t.rootServiceName === 'horus-api'));
});
await eventually('Logs reach Loki', async () => {
  const query = encodeURIComponent('{service_name="horus-api"}');
  const result = await json(`http://127.0.0.1:3100/loki/api/v1/query_range?query=${query}&limit=10`);
  assert.ok(result.data.result.length > 0);
});
console.log('End-to-end OTLP smoke test passed. No deployment performed.');
