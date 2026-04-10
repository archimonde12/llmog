import type { Metrics } from "./metrics";

export type MetricsSummaryJson = {
  uptimeSeconds: number;
  httpRequestsTotal?: number;
  httpErrors1xx?: number;
  httpErrors4xx?: number;
  httpErrors5xx?: number;
  upstreamErrorsTotal?: number;
  requestDurationSeconds?: {
    count: number;
    sum: number;
    meanSeconds?: number;
  };
};

/**
 * Small JSON snapshot from existing prom-client metrics (no extra counters).
 */
export async function buildMetricsSummary(metrics: Metrics): Promise<MetricsSummaryJson> {
  const out: MetricsSummaryJson = {
    uptimeSeconds: process.uptime(),
  };

  const http = await metrics.httpRequestsTotal.get();
  let total = 0;
  let e4 = 0;
  let e5 = 0;
  let e1 = 0;
  for (const v of http.values) {
    total += v.value;
    const sc = v.labels?.status_code;
    if (typeof sc !== "string") continue;
    const code = Number(sc);
    if (!Number.isFinite(code)) continue;
    if (code >= 500) e5 += v.value;
    else if (code >= 400) e4 += v.value;
    else if (code < 200) e1 += v.value;
  }
  out.httpRequestsTotal = total;
  out.httpErrors4xx = e4;
  out.httpErrors5xx = e5;
  out.httpErrors1xx = e1;

  const up = await metrics.upstreamErrorsTotal.get();
  let upSum = 0;
  for (const v of up.values) upSum += v.value;
  out.upstreamErrorsTotal = upSum;

  const hist = await metrics.httpRequestDurationSeconds.get();
  let count = 0;
  let sum = 0;
  for (const v of hist.values) {
    const mn = (v as { metricName?: string }).metricName;
    if (mn?.endsWith("_count")) count += v.value;
    if (mn === "llm_proxy_http_request_duration_seconds_sum") sum += v.value;
  }
  out.requestDurationSeconds = {
    count,
    sum,
    meanSeconds: count > 0 ? sum / count : undefined,
  };

  return out;
}
