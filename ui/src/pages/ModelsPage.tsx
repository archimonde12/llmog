import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { Drawer } from "../components/Drawer";
import { fmtTs } from "../lib/time";

type ModelRow = {
  id: string;
  adapter: "ollama" | "openai_compatible" | "deepseek";
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  apiKey?: string;
  apiKeyHeader?: string;
  headers?: Record<string, string>;
};

type ModelsFile = { models: ModelRow[] };

type ConfigResponse = {
  config: ModelsFile;
};

type Msg = {
  id: string;
  ts: number;
  modelId: string;
  requestId: string;
  endpoint: string;
  role: "system" | "user";
  rawMessageJson: unknown;
};

type MsgResp = { messages: Msg[] };

function toText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const any = raw as any;
  const c = any.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const p of c) {
      if (typeof p === "string") parts.push(p);
      else if (p && typeof p === "object" && typeof (p as any).text === "string") parts.push((p as any).text);
    }
    return parts.join("\n");
  }
  return "";
}

function truncateLines(text: string, maxLines: number) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, truncated: false };
  return { text: lines.slice(0, maxLines).join("\n"), truncated: true };
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

export function ModelsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<Msg | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        setLoading(true);
        const res = await apiGet<ConfigResponse>("/admin/config");
        setModels(res.config.models ?? []);
        setSelectedId(res.config.models?.[0]?.id ?? "");
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selected = useMemo(() => models.find((m) => m.id === selectedId) ?? null, [models, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setMsgs([]);
      return;
    }
    (async () => {
      try {
        setMsgsLoading(true);
        const res = await apiGet<MsgResp>(
          `/admin/models/${encodeURIComponent(selectedId)}/debug/messages?limit=10&roles=system,user`,
        );
        setMsgs(res.messages ?? []);
      } catch {
        setMsgs([]);
      } finally {
        setMsgsLoading(false);
      }
    })();
  }, [selectedId]);

  const prepared = useMemo(() => {
    return msgs.map((m) => {
      const rawText = toText(m.rawMessageJson);
      const t = truncateLines(rawText, 8);
      return { m, preview: t.text, truncated: t.truncated };
    });
  }, [msgs]);

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbarTitle">Models</div>
        <div className="spacer" />
        <div className="muted" style={{ fontSize: "0.82rem" }}>
          Select a model to view details + debug messages
        </div>
      </div>

      {err && <div className="alert err">{err}</div>}
      {loading && <div className="muted">Loading…</div>}

      <div className="split split3070">
        <div className="panel">
          <div className="panelHeader">
            <div className="panelTitle">Configured models</div>
            <div className="panelHint">Select to see details</div>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>id</th>
                  <th>adapter</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr
                    key={m.id}
                    className={`clickable ${m.id === selectedId ? "selectedRow" : ""}`}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <td className="mono">{m.id}</td>
                    <td>{m.adapter}</td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={2} className="muted">
                      No models
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <div className="panelTitle">Details</div>
            <div className="panelHint">{selected ? selected.id : "Select a model"}</div>
          </div>

          {!selected ? (
            <div className="muted">Select a model</div>
          ) : (
            <div className="stack">
              <div className="kv">
                <div className="kvRow">
                  <div className="k">Adapter</div>
                  <div className="v">{selected.adapter}</div>
                </div>
                <div className="kvRow">
                  <div className="k">Base URL</div>
                  <div className="v mono">{selected.baseUrl}</div>
                </div>
                <div className="kvRow">
                  <div className="k">Upstream model</div>
                  <div className="v mono">{selected.model}</div>
                </div>
                <div className="kvRow">
                  <div className="k">Timeout</div>
                  <div className="v mono">{selected.timeoutMs ?? "—"}</div>
                </div>
              </div>

              <div className="panelSub">
                <div className="panelHeader">
                  <div className="panelTitle">Messages (input last 10)</div>
                  <div className="panelHint">Roles: system + user</div>
                  <div className="spacer" />
                  {msgsLoading && <div className="muted">Loading…</div>}
                </div>
                <div className="list">
                  {prepared.map(({ m, preview, truncated }) => (
                    <button key={m.id} type="button" className="listItem" onClick={() => setSelectedMsg(m)}>
                      <div className="listItemTop">
                        <div className={`pill ${m.role}`}>{m.role}</div>
                        <div className="mono muted">{fmtTs(m.ts)}</div>
                        <div className="mono muted">req {m.requestId.slice(0, 8)}…</div>
                      </div>
                      <pre className="msgPreview">
                        {preview}
                        {truncated ? "\n…" : ""}
                      </pre>
                    </button>
                  ))}
                  {!msgsLoading && prepared.length === 0 && <div className="muted">No messages captured yet for this model</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Drawer open={Boolean(selectedMsg)} title={selectedMsg ? `${selectedMsg.role} message` : "Message"} onClose={() => setSelectedMsg(null)}>
        {!selectedMsg ? null : (
          <div className="stack">
            <div className="panelSub">
              <div className="panelHeader">
                <div className="panelTitle">Render text</div>
                <div className="spacer" />
                <button type="button" className="btn mini" onClick={() => copy(toText(selectedMsg.rawMessageJson))}>
                  Copy
                </button>
              </div>
              <pre className="pre">{toText(selectedMsg.rawMessageJson) || "—"}</pre>
            </div>

            <div className="panelSub">
              <div className="panelHeader">
                <div className="panelTitle">Raw JSON</div>
                <div className="spacer" />
                <button type="button" className="btn mini" onClick={() => copy(JSON.stringify(selectedMsg.rawMessageJson, null, 2))}>
                  Copy
                </button>
              </div>
              <pre className="pre mono">{JSON.stringify(selectedMsg.rawMessageJson, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

