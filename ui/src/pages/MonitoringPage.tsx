import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import type { RangeKey } from "../lib/time";
import { Drawer } from "../components/Drawer";
import { clamp, fmtTs } from "../lib/time";

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
    <div className="tooltip" style={{ left: props.x, top: props.y }}>
      {props.children}
    </div>
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
    <div className="chart" onMouseLeave={() => setTip((t) => ({ ...t, open: false }))}>
      {props.series.map((b) => {
        const total = b.tokens_in + b.tokens_out;
        const h = clamp((total / max) * 100, 0, 100);
        const inPct = total > 0 ? (b.tokens_in / total) * 100 : 0;
        return (
          <div
            key={b.ts}
            className="chartBar"
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
            <div className="chartBarStack" style={{ height: `${h}%` }}>
              <div className="chartBarIn" style={{ height: `${inPct}%` }} />
              <div className="chartBarOut" style={{ height: `${100 - inPct}%` }} />
            </div>
          </div>
        );
      })}
      <Tooltip open={tip.open && Boolean(tip.b)} x={tip.x} y={tip.y}>
        {!tip.b ? null : (
          <div className="tipBody">
            <div className="mono">{fmtTs(tip.b.ts)}</div>
            <div className="tipGrid">
              <div className="muted">Tokens in</div>
              <div className="mono">{tip.b.tokens_in}</div>
              <div className="muted">Tokens out</div>
              <div className="mono">{tip.b.tokens_out}</div>
              <div className="muted">Requests</div>
              <div className="mono">{tip.b.req_count}</div>
              <div className="muted">Errors</div>
              <div className="mono">{tip.b.error_count}</div>
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
    <div className="chart" onMouseLeave={() => setTip((t) => ({ ...t, open: false }))}>
      {props.series.map((b) => {
        const h = clamp((b.req_count / max) * 100, 0, 100);
        const errPct = b.req_count > 0 ? (b.error_count / b.req_count) * 100 : 0;
        return (
          <div
            key={b.ts}
            className="chartBar"
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
            <div className="chartBarStack" style={{ height: `${h}%` }}>
              <div className="chartBarErr" style={{ height: `${errPct}%` }} />
              <div className="chartBarOk" style={{ height: `${100 - errPct}%` }} />
            </div>
          </div>
        );
      })}
      <Tooltip open={tip.open && Boolean(tip.b)} x={tip.x} y={tip.y}>
        {!tip.b ? null : (
          <div className="tipBody">
            <div className="mono">{fmtTs(tip.b.ts)}</div>
            <div className="tipGrid">
              <div className="muted">Requests</div>
              <div className="mono">{tip.b.req_count}</div>
              <div className="muted">Errors</div>
              <div className="mono">{tip.b.error_count}</div>
              <div className="muted">Error rate</div>
              <div className="mono">{pct(tip.b.req_count > 0 ? tip.b.error_count / tip.b.req_count : 0)}</div>
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

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbarTitle">Monitoring</div>
        <div className="spacer" />
        <label className="field">
          <span className="fieldLabel">Range</span>
          <select value={props.range} onChange={(e) => props.onRangeChange(e.target.value as RangeKey)}>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="24h">24h</option>
          </select>
        </label>
        <button type="button" className="btn" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {err && <div className="alert err">{err}</div>}
      {loading && <div className="muted">Loading…</div>}

      {overview && (
        <>
          <div className="gridCards">
            <div className="card">
              <div className="k">Total requests</div>
              <div className="v">{overview.req_count}</div>
            </div>
            <div className="card">
              <div className="k" title="Errors / total requests in the selected range">Error rate</div>
              <div className="v">{pct(overview.error_rate)}</div>
            </div>
            <div className="card">
              <div className="k" title="Median latency (50th percentile) from recent model logs">Latency p50 (ms)</div>
              <div className="v">{fmtNum(overview.latency_p50_ms)}</div>
            </div>
            <div className="card">
              <div className="k" title="95th percentile latency from recent model logs">Latency p95 (ms)</div>
              <div className="v">{fmtNum(overview.latency_p95_ms)}</div>
            </div>
            <div className="card">
              <div className="k" title="Sum of prompt_tokens reported by upstream providers">Tokens In</div>
              <div className="v">{overview.tokens_in_total}</div>
            </div>
            <div className="card">
              <div className="k" title="Sum of completion_tokens reported by upstream providers">Tokens Out</div>
              <div className="v">{overview.tokens_out_total}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Tokens in/out</div>
              <div className="panelHint">Hover bars for details</div>
            </div>
            <TokensChart series={overview.timeseries} />
            <div className="legend">
              <div className="legendItem">
                <span className="swatch in" /> Tokens in
              </div>
              <div className="legendItem">
                <span className="swatch out" /> Tokens out
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Requests + errors</div>
              <div className="panelHint">Per bucket (from in-memory model logs)</div>
            </div>
            <RequestsChart series={overview.timeseries} />
            <div className="legend">
              <div className="legendItem">
                <span className="swatch ok" /> OK
              </div>
              <div className="legendItem">
                <span className="swatch err" /> Error
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Recent model requests</div>
              <div className="panelHint">Model-only logs (default)</div>
            </div>

            <div className="filters">
              <label className="field">
                <span className="fieldLabel">Status</span>
                <input value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} placeholder="e.g. 200" />
              </label>
              <label className="field">
                <span className="fieldLabel">Model</span>
                <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
                  <option value="">(any)</option>
                  {modelIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>time</th>
                    <th>model</th>
                    <th>status</th>
                    <th>latency</th>
                    <th>in</th>
                    <th>out</th>
                    <th>total</th>
                    <th>request_id</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((r) => (
                    <tr key={`${r.requestId}-${r.ts}`} className="clickable" onClick={() => setSelected(r)}>
                      <td className="mono">{new Date(r.ts).toLocaleTimeString()}</td>
                      <td>{r.modelId}</td>
                      <td className={r.status >= 400 ? "bad" : "good"}>{r.status}</td>
                      <td className="mono">{fmtNum(r.latencyMs)} ms</td>
                      <td className="mono">{r.usage?.prompt_tokens ?? "N/A"}</td>
                      <td className="mono">{r.usage?.completion_tokens ?? "N/A"}</td>
                      <td className="mono">{r.usage?.total_tokens ?? "N/A"}</td>
                      <td className="mono">
                        {r.requestId.slice(0, 8)}…
                        <button
                          type="button"
                          className="btn mini ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            copy(r.requestId);
                          }}
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">
                        No requests in range
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Drawer
        open={Boolean(selected)}
        title={selected ? `Request ${selected.requestId.slice(0, 8)}…` : "Request"}
        onClose={() => setSelected(null)}
      >
        {!detail ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="kv">
            <div className="kvRow">
              <div className="k">Time</div>
              <div className="v mono">{fmtTs(detail.request.ts)}</div>
            </div>
            <div className="kvRow">
              <div className="k">Model</div>
              <div className="v">{detail.request.modelId}</div>
            </div>
            <div className="kvRow">
              <div className="k">Status</div>
              <div className="v">{detail.request.status}</div>
            </div>
            <div className="kvRow">
              <div className="k">Latency</div>
              <div className="v mono">{fmtNum(detail.request.latencyMs)} ms</div>
            </div>
            <div className="kvRow">
              <div className="k">Tokens in/out/total</div>
              <div className="v mono">
                {(detail.request.usage?.prompt_tokens ?? "N/A") + " / " + (detail.request.usage?.completion_tokens ?? "N/A") + " / " + (detail.request.usage?.total_tokens ?? "N/A")}
              </div>
            </div>
            <div className="kvRow">
              <div className="k">Request ID</div>
              <div className="v mono">
                {detail.request.requestId}{" "}
                <button type="button" className="btn mini" onClick={() => copy(detail.request.requestId)}>
                  Copy
                </button>
              </div>
            </div>
            {detail.request.error && (
              <div className="kvRow">
                <div className="k">Error</div>
                <div className="v bad">{detail.request.error}</div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

