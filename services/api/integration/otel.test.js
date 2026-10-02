import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('instrumented API exports traces, metrics and logs as OTLP protobuf and shuts down', { timeout: 25000 }, async t => {
  const signals = new Map();
  const receiver = createServer(async (req, res) => {
    let bytes = 0; for await (const chunk of req) bytes += chunk.length;
    signals.set(req.url, { bytes, type: req.headers['content-type'] });
    res.writeHead(200, { 'Content-Type': 'application/x-protobuf' }); res.end();
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { receiver.close(resolve); receiver.closeAllConnections(); }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', HORUS_API_TOKEN: 'b'.repeat(64), HORUS_ENABLE_DEMO: 'true', OTEL_SDK_DISABLED: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  const port = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; for (const line of text.split('\n')) { try { const value = JSON.parse(line); if (value.event === 'ready') resolve(value.port); } catch {} } });
    child.on('exit', code => reject(new Error(`API exited ${code}: ${errors}`)));
    child.on('error', reject);
  });
  const headers = { Authorization: `Bearer ${'b'.repeat(64)}` };
  await fetch(`http://127.0.0.1:${port}/demo/latency`, { headers });
  await fetch(`http://127.0.0.1:${port}/demo/error`, { headers });
  child.kill('SIGTERM');
  const result = await exited;
  assert.equal(result.code, 0, errors);
  for (const path of ['/v1/traces', '/v1/metrics', '/v1/logs']) {
    assert.ok(signals.get(path)?.bytes > 0, `Missing ${path}: ${errors}`);
    assert.match(signals.get(path).type, /application\/x-protobuf/);
  }
});
