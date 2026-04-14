import { joinUrl } from "../http";

export type DiscoverAdapter = "ollama" | "openai_compatible" | "deepseek";

export type DiscoverUpstreamModelsInput = {
  adapter: DiscoverAdapter;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type DiscoverUpstreamModelsResult = {
  ok: boolean;
  models: string[];
  message?: string;
  status?: number;
};

async function getJson(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs: number },
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(opts.headers ?? {}),
      },
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function uniqueSorted(ids: string[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    const t = id.trim();
    if (t) seen.add(t);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export async function discoverUpstreamModels(
  input: DiscoverUpstreamModelsInput,
): Promise<DiscoverUpstreamModelsResult> {
  const base = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return { ok: false, models: [], message: "baseUrl is required" };
  }

  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 15_000, 1000), 60_000);
  const headers: Record<string, string> = {};
  const key = input.apiKey?.trim();
  if (key && (input.adapter === "openai_compatible" || input.adapter === "deepseek")) {
    headers.authorization = `Bearer ${key}`;
  }

  try {
    if (input.adapter === "ollama") {
      const url = joinUrl(base, "api/tags");
      const { status, json } = await getJson(url, { headers, timeoutMs });
      if (status !== 200) {
        return {
          ok: false,
          models: [],
          status,
          message: `Ollama tags: HTTP ${status}`,
        };
      }
      const models = (json as { models?: Array<{ name?: string }> })?.models;
      if (!Array.isArray(models)) {
        return { ok: false, models: [], message: "Unexpected Ollama tags response" };
      }
      const names = models.map((m) => String(m?.name ?? "").trim()).filter(Boolean);
      return { ok: true, models: uniqueSorted(names), status };
    }

    const url = joinUrl(base, "v1/models");
    const { status, json } = await getJson(url, { headers, timeoutMs });
    if (status !== 200) {
      return {
        ok: false,
        models: [],
        status,
        message: `OpenAI models: HTTP ${status}`,
      };
    }
    const data = (json as { data?: Array<{ id?: string }> })?.data;
    if (!Array.isArray(data)) {
      return { ok: false, models: [], message: "Unexpected /v1/models response" };
    }
    const ids = data.map((d) => String(d?.id ?? "").trim()).filter(Boolean);
    return { ok: true, models: uniqueSorted(ids), status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, models: [], message: msg };
  }
}
