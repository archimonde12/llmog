import React, { useCallback, useState } from "react";
import { apiPost } from "../lib/api";

type DiscoverResponse = {
  ok: boolean;
  models: string[];
  message?: string;
  status?: number;
};

export function ProbePage() {
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);

  const run = useCallback(async () => {
    setErr(null);
    setLoading(true);
    setModels([]);
    try {
      const r = await apiPost<DiscoverResponse>("/admin/discover-upstream-models", {
        adapter: "openai_compatible",
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      if (!r.ok) {
        setErr(r.message ?? "Discovery failed");
        return;
      }
      setModels(r.models ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, apiKey]);

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbarTitle">Endpoint probe</div>
        <div className="spacer" />
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: "40rem" }}>
        Call <span className="mono">GET /v1/models</span> on an OpenAI-compatible base URL via the server (avoids browser CORS).
        Keys are sent only to your llmog admin API, not stored.
      </p>

      <div className="panel" style={{ maxWidth: "44rem" }}>
        <div className="formGrid formStack">
          <label className="field">
            <span className="fieldLabel">Base URL</span>
            <input
              className="mono"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com"
            />
          </label>
          <label className="field">
            <span className="fieldLabel">API key (optional)</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
          </label>
          <div>
            <button type="button" className="btn btnPrimary" disabled={loading || !baseUrl.trim()} onClick={() => void run()}>
              {loading ? "Fetching…" : "Fetch models"}
            </button>
          </div>
        </div>
      </div>

      {err ? <div className="alert err">{err}</div> : null}

      {models.length > 0 ? (
        <div className="panel" style={{ maxWidth: "44rem" }}>
          <div className="panelTitle" style={{ marginBottom: "0.5rem" }}>
            Models ({models.length})
          </div>
          <ul className="mono" style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.88rem" }}>
            {models.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
