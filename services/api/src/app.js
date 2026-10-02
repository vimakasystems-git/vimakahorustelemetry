import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { COUNTER, InputError, parameters, queries, scalar, calculateSlo, diagnose } from './domain.js';
import { BackendError } from './prometheus.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
const routes = new Set(['/health', '/ready', '/api/v1/services', '/api/v1/slo', '/api/v1/diagnostics', '/api/v1/topology', '/demo/latency', '/demo/error']);
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };

export function createApp({ client, token, enableDemo = false, telemetry = null, maxRequestsPerMinute = 120, now = () => Date.now() }) {
  if (typeof token !== 'string' || token.length < 32 || token.startsWith('replace')) throw new Error('A token with at least 32 characters is required');
  const expected = Buffer.from(`Bearer ${token}`);
  let bucket = { since: 0, count: 0 };
  const authorize = req => {
    const actual = Buffer.from(req.headers.authorization ?? '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  async function report(search, time) {
    const params = parameters(search);
    if (!params.service) throw new InputError('Selecione um servico.');
    const q = queries(params);
    const entries = await Promise.all(Object.entries(q).map(async ([id, query]) => {
      const rows = await client.query(query, time);
      const value = scalar(rows);
      if (rows.length && value === null && id !== 'p95') throw new BackendError('Invalid count');
      return { id, query, value, queriedAt: new Date(time * 1000).toISOString() };
    }));
    const values = Object.fromEntries(entries.map(e => [e.id, e.value]));
    return { ...params, source: 'prometheus', observedAt: new Date(time * 1000).toISOString(), slo: calculateSlo(values.total, values.errors, params.target), p95Seconds: values.p95, evidence: entries };
  }

  const server = httpServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    let path = '/unknown';
    try {
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method_not_allowed' }); }
      if (!req.url?.startsWith('/') || req.url.length > 2048) return send(res, 400, { error: 'invalid_request' });
      const url = new URL(req.url, 'http://localhost');
      path = url.pathname;
      if (assets.has(path)) {
        const [file, type] = assets.get(path);
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(content);
      }
      if (path !== '/health' && !authorize(req)) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return send(res, 401, { error: 'unauthorized' });
      }
      if (path !== '/health') {
        if (now() - bucket.since >= 60000) bucket = { since: now(), count: 0 };
        if (++bucket.count > maxRequestsPerMinute) { res.setHeader('Retry-After', '60'); return send(res, 429, { error: 'rate_limited' }); }
      }
      // All templates in one report use the same evaluation instant, quantized for bounded caching.
      const time = Math.floor(now() / 5000) * 5;
      const handler = async () => {
        if (path === '/health') return send(res, 200, { status: 'ok', service: 'horus-api', version: '0.2.0' });
        if (path === '/ready') { await client.query('vector(1)', time); return send(res, 200, { status: 'ready', checks: ['prometheus-query'] }); }
        if (path === '/api/v1/services') {
          const { window } = parameters(url.searchParams);
          const query = `sum by (service_name) (increase(${COUNTER}{span_kind="SPAN_KIND_SERVER"}[${window}]))`;
          const rows = await client.query(query, time);
          const services = rows.filter(row => typeof row.metric.service_name === 'string').map(row => ({ name: row.metric.service_name, requests: scalar([row]) })).sort((a, b) => a.name.localeCompare(b.name));
          return send(res, 200, { source: 'prometheus', status: services.length ? 'observed' : 'no_data', window, observedAt: new Date(time * 1000).toISOString(), query, services });
        }
        if (path === '/api/v1/slo' || path === '/api/v1/diagnostics') {
          const data = await report(url.searchParams, time);
          return send(res, 200, path.endsWith('/diagnostics') ? diagnose(data) : data);
        }
        if (path === '/api/v1/topology') {
          const { window } = parameters(url.searchParams);
          const query = `sum by (client, server) (rate(traces_service_graph_request_total[${window}]))`;
          const rows = await client.query(query, time);
          const edges = rows.filter(row => row.metric.client && row.metric.server && scalar([row]) > 0).map(row => ({ from: row.metric.client, to: row.metric.server, requestsPerSecond: scalar([row]) }));
          return send(res, 200, { source: 'servicegraph', status: edges.length ? 'observed' : 'no_data', window, query, edges, nodes: [...new Set(edges.flatMap(e => [e.from, e.to]))].sort() });
        }
        if (enableDemo && path === '/demo/latency') { await new Promise(resolve => setTimeout(resolve, 40)); return send(res, 200, { ok: true, simulated: true }); }
        if (enableDemo && path === '/demo/error') return send(res, 500, { error: 'simulated_error', simulated: true });
        return send(res, 404, { error: 'not_found' });
      };
      if (telemetry) await telemetry.run(routes.has(path) ? path : '/unknown', req, res, handler);
      else await handler();
    } catch (error) {
      if (res.headersSent) return res.end();
      send(res, error instanceof InputError ? 400 : error instanceof BackendError ? 503 : 500, {
        error: error instanceof InputError ? 'invalid_parameters' : error instanceof BackendError ? 'backend_unavailable' : 'internal_error'
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}
