import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { Drawer } from "../components/Drawer";
import { fmtTs } from "../lib/time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <Button type="button" variant="outline" size="sm" onClick={props.onBack}>
          Back
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">Model: {props.modelId}</h1>
        <span className="text-xs text-muted-foreground">Messages (input last 10)</span>
      </div>

      {err ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>
      ) : null}
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Messages</CardTitle>
          <p className="text-xs text-muted-foreground">Roles: system + user. Click to inspect raw JSON.</p>
        </CardHeader>
        <CardContent className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
          {prepared.map(({ m, preview, truncated }) => (
            <button
              key={m.id}
              type="button"
              className="rounded-lg border border-border/60 bg-muted/10 p-3 text-left transition-colors hover:bg-muted/25"
              onClick={() => setSelected(m)}
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
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
                {preview}
                {truncated ? "\n…" : ""}
              </pre>
            </button>
          ))}
          {prepared.length === 0 ? <p className="text-sm text-muted-foreground">No messages captured yet for this model</p> : null}
        </CardContent>
      </Card>

      <Drawer
        open={Boolean(selected)}
        title={selected ? `${selected.role} message` : "Message"}
        onClose={() => setSelected(null)}
      >
        {!selected ? null : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border/80 bg-muted/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Render text</h3>
                <Button type="button" size="sm" variant="secondary" onClick={() => copy(toText(selected.rawMessageJson))}>
                  Copy
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-xs">{toText(selected.rawMessageJson) || "—"}</pre>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Raw JSON</h3>
                <Button type="button" size="sm" variant="secondary" onClick={() => copy(JSON.stringify(selected.rawMessageJson, null, 2))}>
                  Copy
                </Button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(selected.rawMessageJson, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

