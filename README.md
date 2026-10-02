# Vimaka Horus Telemetry

OpenTelemetry-first observability platform by Vimaka Sistemas Inteligentes.

## Goals
- Unified metrics, logs, traces, profiles, events and topology
- Infrastructure, applications, websites, networks and AI workloads
- Vendor-neutral OTLP ingestion
- Open-source-first stack
- Evidence-backed AI root cause analysis

## Quick start
```bash
cp .env.example .env
docker compose up -d --build
```

Endpoints:
- API: http://localhost:8080
- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- Tempo OTLP gRPC: localhost:4317
- Tempo OTLP HTTP: localhost:4318
- Pyroscope: http://localhost:4040

## Architecture
Applications/Agents -> OpenTelemetry Collector -> metrics/logs/traces/profiles backends -> Grafana/custom UI -> correlation/AI/remediation.

See `docs/ARCHITECTURE.md` and `blueprint/observability-blueprint.json`.
