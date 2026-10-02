import { createApp } from './app.js';
import { PrometheusClient } from './prometheus.js';

const token = process.env.HORUS_API_TOKEN;
if (!token || token.length < 32 || token.startsWith('replace')) throw new Error('Configure HORUS_API_TOKEN with at least 32 random characters.');
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const host = process.env.HOST || '127.0.0.1';
const client = new PrometheusClient(process.env.PROMETHEUS_URL || 'http://127.0.0.1:9090');
let telemetry = null;
if (process.env.OTEL_SDK_DISABLED !== 'true') {
  const { startTelemetry } = await import('./instrumentation.js');
  telemetry = startTelemetry();
}
const server = createApp({ client, token, telemetry, enableDemo: process.env.HORUS_ENABLE_DEMO === 'true' });
server.listen(port, host, () => console.log(JSON.stringify({ event: 'ready', port: server.address().port, host, telemetry: Boolean(telemetry) })));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    await new Promise(resolve => server.close(resolve));
    await telemetry?.shutdown();
    clearTimeout(deadline);
    process.exitCode = 0;
  } catch {
    console.error('Graceful shutdown failed');
    process.exitCode = 1;
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
