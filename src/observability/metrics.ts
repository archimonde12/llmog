import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import client from "prom-client";

export type Metrics = {
  registry: client.Registry;
  httpRequestsTotal: client.Counter<string>;
  httpRequestDurationSeconds: client.Histogram<string>;
  upstreamErrorsTotal: client.Counter<string>;
  tokensInTotal: client.Counter<string>;
  tokensOutTotal: client.Counter<string>;
  tokensTotal: client.Counter<string>;
  observeTokens: (args: {
    modelId: string;
    adapter: string;
    tokensIn?: number;
    tokensOut?: number;
    tokensTotal?: number;
  }) => void;
};

function routeLabel(req: FastifyRequest) {
  const anyReq = req as any;
  const route = anyReq.routeOptions?.url;
  if (typeof route === "string" && route) return route;
  return req.url.split("?")[0] ?? "<unknown>";
}

export function createMetrics(): Metrics {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new client.Counter({
    name: "llm_proxy_http_requests_total",
    help: "HTTP requests completed",
    registers: [registry],
    labelNames: ["method", "route", "status_code"] as const,
  });

  const httpRequestDurationSeconds = new client.Histogram({
    name: "llm_proxy_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    registers: [registry],
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

  const upstreamErrorsTotal = new client.Counter({
    name: "llm_proxy_upstream_errors_total",
    help: "Upstream errors by adapter/model",
    registers: [registry],
    labelNames: ["model_id", "adapter"] as const,
  });

  const tokensInTotal = new client.Counter({
    name: "llm_proxy_tokens_in_total",
    help: "Total input/prompt tokens (best-effort)",
    registers: [registry],
    labelNames: ["model_id", "adapter"] as const,
  });

  const tokensOutTotal = new client.Counter({
    name: "llm_proxy_tokens_out_total",
    help: "Total output/completion tokens (best-effort)",
    registers: [registry],
    labelNames: ["model_id", "adapter"] as const,
  });

  const tokensTotal = new client.Counter({
    name: "llm_proxy_tokens_total",
    help: "Total tokens (best-effort)",
    registers: [registry],
    labelNames: ["model_id", "adapter"] as const,
  });

  const observeTokens: Metrics["observeTokens"] = (args) => {
    const labels = { model_id: args.modelId, adapter: args.adapter };
    if (typeof args.tokensIn === "number" && Number.isFinite(args.tokensIn)) {
      tokensInTotal.inc(labels, args.tokensIn);
    }
    if (typeof args.tokensOut === "number" && Number.isFinite(args.tokensOut)) {
      tokensOutTotal.inc(labels, args.tokensOut);
    }
    if (typeof args.tokensTotal === "number" && Number.isFinite(args.tokensTotal)) {
      tokensTotal.inc(labels, args.tokensTotal);
    }
  };

  return {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    upstreamErrorsTotal,
    tokensInTotal,
    tokensOutTotal,
    tokensTotal,
    observeTokens,
  };
}

export async function registerMetrics(app: FastifyInstance, metrics: Metrics) {
  app.addHook("onRequest", async (req) => {
    (req as any).__metricsStartAt = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const startAt = (req as any).__metricsStartAt as bigint | undefined;
    const durationSeconds = startAt
      ? Number(process.hrtime.bigint() - startAt) / 1e9
      : undefined;

    const labels = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(reply.statusCode),
    };

    metrics.httpRequestsTotal.inc(labels, 1);
    if (typeof durationSeconds === "number") {
      metrics.httpRequestDurationSeconds.observe(labels, durationSeconds);
    }
  });

  app.get("/metrics", async (_req, reply: FastifyReply) => {
    reply.header("content-type", metrics.registry.contentType);
    return await metrics.registry.metrics();
  });
}

