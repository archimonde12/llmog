import React, { useCallback, useState } from "react";
import { apiPost } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="flex min-h-0 flex-col gap-4">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Endpoint probe</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Call <span className="font-mono text-foreground/90">GET /v1/models</span> on an OpenAI-compatible base URL via the server (avoids browser CORS).
          Keys are sent only to your llmog admin API, not stored.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Probe</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="probe-base">Base URL</Label>
            <Input id="probe-base" className="font-mono text-sm" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="probe-key">API key (optional)</Label>
            <Input
              id="probe-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
          </div>
          <Button type="button" disabled={loading || !baseUrl.trim()} onClick={() => void run()}>
            {loading ? "Fetching…" : "Fetch models"}
          </Button>
        </CardContent>
      </Card>

      {err ? (
        <div className="max-w-2xl rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>
      ) : null}

      {models.length > 0 ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Models ({models.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 font-mono text-sm text-foreground/90">
              {models.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
