# Architecture

## Core principles
1. OpenTelemetry and OTLP are the default telemetry contracts.
2. Backends are replaceable and must not leak into application instrumentation.
3. Every incident hypothesis must link to observable evidence.
4. High-cardinality attributes, secrets and PII must be controlled before export.
5. Collection must support agent, gateway, regional and central modes.

## Signal path
Source -> OTel SDK/auto-instrumentation/eBPF -> OTel Collector -> backend -> correlation graph -> AI/RCA -> alert/remediation.

## Initial backends
- Metrics: Prometheus
- Logs: Loki
- Traces: Tempo
- Profiles: Pyroscope
- Metadata/control plane: PostgreSQL
- Visualization: Grafana

## Planned engines
- Topology engine
- Causal incident graph
- SLO/error budget engine
- Fleet manager
- AI RCA engine
- Remediation orchestrator

## Security
mTLS, OIDC, tenant isolation, redaction, RBAC, audit events and approval gates for remediation are mandatory for production.
