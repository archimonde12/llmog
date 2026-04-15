import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import type { RangeKey } from "../lib/time";
import { Drawer } from "../components/Drawer";
import { clamp, fmtTs } from "../lib/time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Overview = {
  req_count: number;
  error_rate: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  tokens_in_total: number;
  tokens_out_total: number;
  timeseries: Array<{
    ts: number;
    tokens_in: number;
    tokens_out: number;
    req_count: number;
    error_count: number;
  }>;
};

type ModelLogRow = {
  ts: number;
  requestId: string;
  modelId: string;
  endpoint: string;
  status: number;
  latencyMs: number;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

type LogsResponse = { logs: ModelLogRow[] };

type RequestDetail = {
  request: {
    ts: number;
    requestId: string;
    modelId: string;
    endpoint: string;
    status: number;
    latencyMs: number;
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    error: string | null;
  };
};

function pct(n: number) {
  return `${Math.round(n * 1000) / 10}%`;
}

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n * 100) / 100);
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function Tooltip(props: { open: boolean; x: number; y: number; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div
      className="pointer-events-none fixed z-[60] min-w-[10rem] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
      style={{ left: props.x, top: props.y - 8 }}
    >
      {props.children}
    </div>
  );
}

function StatSparkline(props: {
  series: Overview["timeseries"];
  pick: (b: Overview["timeseries"][number]) => number;
  strokeClass: string;
}) {
  const { series, pick, strokeClass } = props;
  if (!series.length) return null;
  const vals = series.map(pick);
  const max = Math.max(1, ...vals);
  const w = 128;
  const h = 32;
  const step = series.length > 1 ? w / (series.length - 1) : 0;
  const pts = series.map((b, i) => {
    const x = series.length > 1 ? i * step : w / 2;
    const y = h - (pick(b) / max) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} className={cn("mt-2", strokeClass)} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}

function TokensChart(props: { series: Overview["timeseries"] }) {
  const max = useMemo(() => {
    let m = 0;
    for (const b of props.series) m = Math.max(m, b.tokens_in + b.tokens_out);
    return m || 1;
  }, [props.series]);

  const [tip, setTip] = useState<{ open: boolean; x: number; y: number; b: Overview["timeseries"][number] | null }>({
    open: false,
    x: 0,
    y: 0,
    b: null,
  });

  return (
    <div className="relative flex h-28 w-full items-end gap-px" onMouseLeave={() => setTip((t) => ({ ...t, open: false }))}>
      {props.series.map((b) => {
        const total = b.tokens_in + b.tokens_out;
        const h = clamp((total / max) * 100, 0, 100);
        const inPct = total > 0 ? (b.tokens_in / total) * 100 : 0;
        return (
          <div
            key={b.ts}
            className="relative flex min-w-[3px] max-w-[10px] flex-1 cursor-default items-end"
            onMouseMove={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setTip({
                open: true,
                x: rect.left + rect.width / 2 + window.scrollX,
                y: rect.top + window.scrollY,
                b,
              });
            }}
          >
            <div className="flex w-full flex-col overflow-hidden rounded-sm" style={{ height: `${h}%` }}>
              <div className="w-full bg-sky-400/75" style={{ height: `${inPct}%`, minHeight: total > 0 ? 2 : 0 }} />
              <div className="w-full bg-violet-400/75" style={{ height: `${100 - inPct}%`, minHeight: 2 }} />
            </div>
          </div>
        );
      })}
      <Tooltip open={tip.open && Boolean(tip.b)} x={tip.x} y={tip.y}>
        {!tip.b ? null : (
          <div>
            <div className="font-mono text-[10px] text-muted-foreground">{fmtTs(tip.b.ts)}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <div className="text-muted-foreground">Tokens in</div>
              <div className="font-mono text-right">{tip.b.tokens_in}</div>
              <div className="text-muted-foreground">Tokens out</div>
              <div className="font-mono text-right">{tip.b.tokens_out}</div>
              <div className="text-muted-foreground">Requests</div>
              <div className="font-mono text-right">{tip.b.req_count}</div>
              <div className="text-muted-foreground">Errors</div>
              <div className="font-mono text-right">{tip.b.error_count}</div>
            </div>
          </div>
        )}
      </Tooltip>
    </div>
  );
}

function RequestsChart(props: { series: Overview["timeseries"] }) {
  const max = useMemo(() => {
    let m = 0;
    for (const b of props.series) m = Math.max(m, b.req_count);
    return m || 1;
  }, [props.series]);

  const [tip, setTip] = useState<{ open: boolean; x: number; y: number; b: Overview["timeseries"][number] | null }>({
    open: false,
    x: 0,
    y: 0,
    b: null,
  });

  return (
    <div className="relative flex h-28 w-full items-end gap-px" onMouseLeave={() => setTip((t) => ({ ...t, open: false }))}>
      {props.series.map((b) => {
        const h = clamp((b.req_count / max) * 100, 0, 100);
        const errPct = b.req_count > 0 ? (b.error_count / b.req_count) * 100 : 0;
        return (
          <div
            key={b.ts}
            className="relative flex min-w-[3px] max-w-[10px] flex-1 cursor-default items-end"
            onMouseMove={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setTip({
                open: true,
                x: rect.left + rect.width / 2 + window.scrollX,
                y: rect.top + window.scrollY,
                b,
              });
            }}
          >
            <div className="flex w-full flex-col overflow-hidden rounded-sm" style={{ height: `${h}%` }}>
              <div className="w-full bg-red-400/80" style={{ height: `${errPct}%`, minHeight: b.req_count > 0 ? 2 : 0 }} />
              <div className="w-full bg-emerald-400/75" style={{ height: `${100 - errPct}%`, minHeight: 2 }} />
            </div>
          </div>
        );
      })}
      <Tooltip open={tip.open && Boolean(tip.b)} x={tip.x} y={tip.y}>
        {!tip.b ? null : (
          <div>
            <div className="font-mono text-[10px] text-muted-foreground">{fmtTs(tip.b.ts)}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <div className="text-muted-foreground">Requests</div>
              <div className="font-mono text-right">{tip.b.req_count}</div>
              <div className="text-muted-foreground">Errors</div>
              <div className="font-mono text-right">{tip.b.error_count}</div>
              <div className="text-muted-foreground">Error rate</div>
              <div className="font-mono text-right">{pct(tip.b.req_count > 0 ? tip.b.error_count / tip.b.req_count : 0)}</div>
            </div>
          </div>
        )}
      </Tooltip>
    </div>
  );
}

export function MonitoringPage(props: { range: RangeKey; onRangeChange: (r: RangeKey) => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [logs, setLogs] = useState<ModelLogRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [selected, setSelected] = useState<ModelLogRow | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    const r = props.range;
    const [o, l] = await Promise.all([
      apiGet<Overview>(`/admin/metrics/overview?range=${encodeURIComponent(r)}`),
      apiGet<LogsResponse>(
        `/admin/logs/models?range=${encodeURIComponent(r)}&limit=200` +
          (modelFilter ? `&modelId=${encodeURIComponent(modelFilter)}` : "") +
          (statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ""),
      ),
    ]);
    setOverview(o);
    setLogs(l.logs ?? []);
  }, [props.range, modelFilter, statusFilter]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      try {
        setDetail(null);
        const d = await apiGet<RequestDetail>(`/admin/requests/${encodeURIComponent(selected.requestId)}`);
        setDetail(d);
      } catch {
        setDetail(null);
      }
    })();
  }, [selected]);

  const modelIds = useMemo(() => {
    return Array.from(new Set(logs.map((r) => r.modelId))).sort();
  }, [logs]);

  const selectFieldClass =
    "flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Monitoring</h1>
        <div className="flex-1" />
        <div className="flex flex-col gap-1">
          <Label htmlFor="mon-range">Range</Label>
          <select
            id="mon-range"
            className={selectFieldClass}
            value={props.range}
            onChange={(e) => props.onRangeChange(e.target.value as RangeKey)}
          >
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="24h">24h</option>
          </select>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {err ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>
      ) : null}
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      {overview && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total requests</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{overview.req_count}</div>
                <StatSparkline series={overview.timeseries} pick={(b) => b.req_count} strokeClass="text-sky-400" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground" title="Errors / total requests in the selected range">
                  Error rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{pct(overview.error_rate)}</div>
                <StatSparkline series={overview.timeseries} pick={(b) => b.error_count} strokeClass="text-red-400" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground" title="Median latency (50th percentile) from recent model logs">
                  Latency p50 (ms)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{fmtNum(overview.latency_p50_ms)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground" title="95th percentile latency from recent model logs">
                  Latency p95 (ms)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{fmtNum(overview.latency_p95_ms)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground" title="Sum of prompt_tokens reported by upstream providers">
                  Tokens In
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{overview.tokens_in_total}</div>
                <StatSparkline series={overview.timeseries} pick={(b) => b.tokens_in} strokeClass="text-sky-400" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground" title="Sum of completion_tokens reported by upstream providers">
                  Tokens Out
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{overview.tokens_out_total}</div>
                <StatSparkline series={overview.timeseries} pick={(b) => b.tokens_out} strokeClass="text-violet-400" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Tokens in/out</CardTitle>
              <p className="text-xs text-muted-foreground">Hover bars for details</p>
            </CardHeader>
            <CardContent>
              <TokensChart series={overview.timeseries} />
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm bg-sky-400/80" /> Tokens in
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm bg-violet-400/80" /> Tokens out
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Requests + errors</CardTitle>
              <p className="text-xs text-muted-foreground">Per bucket (from in-memory model logs)</p>
            </CardHeader>
            <CardContent>
              <RequestsChart series={overview.timeseries} />
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm bg-emerald-400/80" /> OK
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm bg-red-400/80" /> Error
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-1 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Recent model requests</CardTitle>
                <p className="text-xs text-muted-foreground">Model-only logs (default)</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="mon-status">Status</Label>
                  <input
                    id="mon-status"
                    className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    placeholder="e.g. 200"
                  />
                </div>
                <div className="flex min-w-[10rem] flex-col gap-1">
                  <Label htmlFor="mon-model">Model</Label>
                  <select id="mon-model" className={cn(selectFieldClass, "min-w-[10rem]")} value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
                    <option value="">(any)</option>
                    {modelIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">time</th>
                      <th className="px-3 py-2 font-medium">model</th>
                      <th className="px-3 py-2 font-medium">status</th>
                      <th className="px-3 py-2 font-medium">latency</th>
                      <th className="px-3 py-2 font-medium">in</th>
                      <th className="px-3 py-2 font-medium">out</th>
                      <th className="px-3 py-2 font-medium">total</th>
                      <th className="px-3 py-2 font-medium">request_id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((r) => (
                      <tr
                        key={`${r.requestId}-${r.ts}`}
                        className="cursor-pointer border-b border-border/60 transition-colors hover:bg-white/[0.04]"
                        onClick={() => setSelected(r)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{new Date(r.ts).toLocaleTimeString()}</td>
                        <td className="px-3 py-2">{r.modelId}</td>
                        <td className={cn("px-3 py-2 font-medium", r.status >= 400 ? "text-red-400" : "text-emerald-400")}>{r.status}</td>
                        <td className="px-3 py-2 font-mono text-xs">{fmtNum(r.latencyMs)} ms</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.usage?.prompt_tokens ?? "N/A"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.usage?.completion_tokens ?? "N/A"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.usage?.total_tokens ?? "N/A"}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {r.requestId.slice(0, 8)}…
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-2 h-7 px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              copy(r.requestId);
                            }}
                          >
                            Copy
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                          No requests in range
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Drawer
        open={Boolean(selected)}
        title={selected ? `Request ${selected.requestId.slice(0, 8)}…` : "Request"}
        onClose={() => setSelected(null)}
      >
        {!detail ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="font-mono text-xs sm:text-right">{fmtTs(detail.request.ts)}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="sm:text-right">{detail.request.modelId}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="sm:text-right">{detail.request.status}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">Latency</dt>
              <dd className="font-mono text-xs sm:text-right">{fmtNum(detail.request.latencyMs)} ms</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">Tokens in/out/total</dt>
              <dd className="font-mono text-xs sm:text-right">
                {(detail.request.usage?.prompt_tokens ?? "N/A") + " / " + (detail.request.usage?.completion_tokens ?? "N/A") + " / " + (detail.request.usage?.total_tokens ?? "N/A")}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">Request ID</dt>
              <dd className="flex flex-wrap items-center gap-2 font-mono text-xs sm:justify-end">
                <span className="break-all">{detail.request.requestId}</span>
                <Button type="button" size="sm" variant="secondary" onClick={() => copy(detail.request.requestId)}>
                  Copy
                </Button>
              </dd>
            </div>
            {detail.request.error ? (
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-muted-foreground">Error</dt>
                <dd className="text-sm text-destructive sm:text-right">{detail.request.error}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </Drawer>
    </div>
  );
}

