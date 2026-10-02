import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { context, propagation, trace, metrics, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { AlwaysOnSampler } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';

/** Explicit manual instrumentation avoids ESM auto-instrumentation loader ambiguity. */
export function startTelemetry(env = process.env) {
  const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318').replace(/\/$/, '');
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid OTLP endpoint');
  const sdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({
      'service.name': env.OTEL_SERVICE_NAME || 'horus-api',
      'service.version': '0.2.0',
      'service.instance.id': randomUUID(),
      'deployment.environment.name': env.HORUS_ENVIRONMENT || 'development'
    }),
    sampler: new AlwaysOnSampler(),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 5000
    }),
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs` }))]
  });
  sdk.start();
  const tracer = trace.getTracer('horus-api', '0.2.0');
  const meter = metrics.getMeter('horus-api', '0.2.0');
  const counter = meter.createCounter('horus.requests');
  const duration = meter.createHistogram('horus.request.duration', { unit: 's' });
  const logger = logs.getLogger('horus-api', '0.2.0');
  return {
    shutdown: () => sdk.shutdown(),
    run(route, req, res, handler) {
      const parent = propagation.extract(context.active(), req.headers);
      return tracer.startActiveSpan(`GET ${route}`, {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': 'GET', 'http.route': route }
      }, parent, async span => {
        const started = performance.now();
        const requestContext = trace.setSpan(context.active(), span);
        let ended = false;
        const finish = () => {
          if (ended) return;
          ended = true;
          const status = res.writableFinished ? res.statusCode : 499;
          const attributes = { 'http.route': route, 'http.response.status_code': status };
          span.setAttribute('http.response.status_code', status);
          if (status >= 500 || status === 499) span.setStatus({ code: SpanStatusCode.ERROR });
          counter.add(1, attributes);
          duration.record((performance.now() - started) / 1000, attributes);
          // No headers, request bodies, raw URLs, credentials or arbitrary error messages are logged.
          logger.emit({ context: requestContext, severityNumber: status >= 500 ? 17 : 9, severityText: status >= 500 ? 'ERROR' : 'INFO', body: 'HTTP request completed', attributes });
          span.end();
        };
        res.once('finish', finish);
        res.once('close', finish);
        return handler();
      });
    }
  };
}
