import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { Drawer } from "../components/Drawer";
import { fmtTs } from "../lib/time";

type Msg = {
  id: string;
  ts: number;
  modelId: string;
  requestId: string;
  endpoint: string;
  role: "system" | "user";
  rawMessageJson: unknown;
};

type Resp = { messages: Msg[] };

function toText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const any = raw as any;
  const c = any.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    // Best-effort: OpenAI supports content parts. Render text-ish pieces.
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

export function ModelDetailPage(props: { modelId: string; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Msg[]>([]);
  const [selected, setSelected] = useState<Msg | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        setLoading(true);
        const res = await apiGet<Resp>(
          `/admin/models/${encodeURIComponent(props.modelId)}/debug/messages?limit=10&roles=system,user`,
        );
        setItems(res.messages ?? []);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [props.modelId]);

  const prepared = useMemo(() => {
    return items.map((m) => {
      const rawText = toText(m.rawMessageJson);
      const t = truncateLines(rawText, 8);
      return { m, preview: t.text, truncated: t.truncated, rawText };
    });
  }, [items]);

  return (
    <div className="page">
      <div className="topbar">
        <button type="button" className="btn" onClick={props.onBack}>
          Back
        </button>
        <div className="topbarTitle">Model: {props.modelId}</div>
        <div className="spacer" />
        <div className="muted">Messages (input last 10)</div>
      </div>

      {err && <div className="alert err">{err}</div>}
      {loading && <div className="muted">Loading…</div>}

      <div className="panel">
        <div className="panelHeader">
          <div className="panelTitle">Messages</div>
          <div className="panelHint">Roles: system + user. Click to inspect raw JSON.</div>
        </div>

        <div className="list">
          {prepared.map(({ m, preview, truncated }) => (
            <button key={m.id} type="button" className="listItem" onClick={() => setSelected(m)}>
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
          {prepared.length === 0 && <div className="muted">No messages captured yet for this model</div>}
        </div>
      </div>

      <Drawer
        open={Boolean(selected)}
        title={selected ? `${selected.role} message` : "Message"}
        onClose={() => setSelected(null)}
      >
        {!selected ? null : (
          <div className="stack">
            <div className="panelSub">
              <div className="panelHeader">
                <div className="panelTitle">Render text</div>
                <div className="spacer" />
                <button type="button" className="btn mini" onClick={() => copy(toText(selected.rawMessageJson))}>
                  Copy
                </button>
              </div>
              <pre className="pre">{toText(selected.rawMessageJson) || "—"}</pre>
            </div>

            <div className="panelSub">
              <div className="panelHeader">
                <div className="panelTitle">Raw JSON</div>
                <div className="spacer" />
                <button
                  type="button"
                  className="btn mini"
                  onClick={() => copy(JSON.stringify(selected.rawMessageJson, null, 2))}
                >
                  Copy
                </button>
              </div>
              <pre className="pre mono">{JSON.stringify(selected.rawMessageJson, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

