import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { Drawer } from "../components/Drawer";
import { fmtTs } from "../lib/time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Models</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Select a model to view details + debug messages</p>
        </div>
      </div>

      {err ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>
      ) : null}
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Configured models</CardTitle>
            <p className="text-xs text-muted-foreground">Select to see details</p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 px-4 pb-4">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">id</th>
                  <th className="py-2 font-medium">adapter</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr
                    key={m.id}
                    className={cn(
                      "cursor-pointer border-b border-border/60 transition-colors hover:bg-white/[0.04]",
                      m.id === selectedId ? "bg-primary/10" : "",
                    )}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <td className="py-2 font-mono text-xs">{m.id}</td>
                    <td className="py-2 text-xs">{m.adapter}</td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                      No models
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Details</CardTitle>
            <p className="text-xs text-muted-foreground">{selected ? selected.id : "Select a model"}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Select a model</p>
            ) : (
              <>
                <dl className="grid gap-2 rounded-lg border border-border/80 bg-muted/10 p-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Adapter</dt>
                    <dd>{selected.adapter}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Base URL</dt>
                    <dd className="truncate font-mono text-xs">{selected.baseUrl}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Upstream model</dt>
                    <dd className="truncate font-mono text-xs">{selected.model}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Timeout</dt>
                    <dd className="font-mono text-xs">{selected.timeoutMs ?? "—"}</dd>
                  </div>
                </dl>

                <div className="rounded-lg border border-border/80 bg-muted/5 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">Messages (input last 10)</h3>
                    <span className="text-xs text-muted-foreground">Roles: system + user</span>
                    {msgsLoading ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
                  </div>
                  <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                    {prepared.map(({ m, preview, truncated }) => (
                      <button
                        key={m.id}
                        type="button"
                        className="rounded-lg border border-border/60 bg-background/50 p-2 text-left transition-colors hover:bg-muted/30"
                        onClick={() => setSelectedMsg(m)}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 font-semibold uppercase",
                              m.role === "system" ? "bg-amber-500/15 text-amber-200" : "bg-sky-500/15 text-sky-100",
                            )}
                          >
                            {m.role}
                          </span>
                          <span className="font-mono">{fmtTs(m.ts)}</span>
                          <span className="font-mono">req {m.requestId.slice(0, 8)}…</span>
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground/90">
                          {preview}
                          {truncated ? "\n…" : ""}
                        </pre>
                      </button>
                    ))}
                    {!msgsLoading && prepared.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No messages captured yet for this model</p>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Drawer open={Boolean(selectedMsg)} title={selectedMsg ? `${selectedMsg.role} message` : "Message"} onClose={() => setSelectedMsg(null)}>
        {!selectedMsg ? null : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border/80 bg-muted/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Render text</h3>
                <Button type="button" size="sm" variant="secondary" onClick={() => copy(toText(selectedMsg.rawMessageJson))}>
                  Copy
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-xs">{toText(selectedMsg.rawMessageJson) || "—"}</pre>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Raw JSON</h3>
                <Button type="button" size="sm" variant="secondary" onClick={() => copy(JSON.stringify(selectedMsg.rawMessageJson, null, 2))}>
                  Copy
                </Button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(selectedMsg.rawMessageJson, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

