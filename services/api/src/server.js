import express from "express";
import { trace, metrics } from "@opentelemetry/api";

const app = express();
const port = Number(process.env.PORT || 8080);
const meter = metrics.getMeter("horus-api");
const requestCounter = meter.createCounter("horus.http.requests", {
  description: "Horus API request count"
});

app.use(express.json());

app.get("/health", (_req, res) => {
  requestCounter.add(1, { route: "/health", status: "ok" });
  res.json({ status: "ok", service: "horus-api" });
});

app.get("/demo/latency", async (_req, res) => {
  requestCounter.add(1, { route: "/demo/latency" });

  await trace.getTracer("horus-api").startActiveSpan("demo-latency-work", async (span) => {
    const delay = Math.floor(Math.random() * 250) + 25;
    span.setAttribute("demo.delay_ms", delay);
    await new Promise((resolve) => setTimeout(resolve, delay));
    span.end();
    res.json({ ok: true, delay_ms: delay });
  });
});

app.get("/demo/error", (_req, res) => {
  requestCounter.add(1, { route: "/demo/error", error: "true" });
  const span = trace.getActiveSpan();
  span?.setAttribute("error.type", "demo_error");
  res.status(500).json({ error: "simulated_error" });
});

app.listen(port, () => {
  console.log(`Horus API listening on :${port}`);
});
