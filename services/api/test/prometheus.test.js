import test from 'node:test';
import assert from 'node:assert/strict';
import { PrometheusClient, BackendError } from '../src/prometheus.js';
const payload = { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [1, '5'] }] } };
const json = x => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });

test('query is encoded, time pinned and concurrent identical requests coalesced', async () => {
  let calls = 0;
  const client = new PrometheusClient('http://prometheus:9090', { fetchImpl: async (url, options) => {
    calls++; assert.equal(url.searchParams.get('query'), 'sum(a{b="x"})'); assert.equal(url.searchParams.get('time'), '10');
    assert.equal(options.redirect, 'error'); return json(payload);
  } });
  await Promise.all([client.query('sum(a{b="x"})', 10), client.query('sum(a{b="x"})', 10)]);
  await client.query('sum(a{b="x"})', 10); assert.equal(calls, 1);
});
for (const [label, response] of [
  ['HTTP error', () => new Response('secret details', { status: 500 })],
  ['invalid JSON', () => new Response('not json')],
  ['error payload', () => json({ status: 'error' })],
  ['invalid sample', () => json({ status: 'success', data: { resultType: 'vector', result: [{}] } })],
  ['partial result', () => json({ ...payload, warnings: ['partial data'] })],
  ['oversized body', () => new Response('x'.repeat(2000))]
]) test(`rejects ${label} without leaking upstream`, async () => {
  const client = new PrometheusClient('http://prometheus:9090', { maxBytes: 1024, fetchImpl: async () => response() });
  await assert.rejects(client.query('up', 1), e => e instanceof BackendError && !e.message.includes('secret'));
});
test('query timeout aborts the fetch', async () => {
  const client = new PrometheusClient('http://prometheus:9090', { timeoutMs: 10, fetchImpl: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(client.query('up', 1), BackendError);
});
test('rejects URL schemes and embedded credentials', () => {
  for (const u of ['file:///etc/passwd', 'http://admin:secret@example.com', 'https://x/?secret=1']) assert.throws(() => new PrometheusClient(u));
});
