import type { ModelAdapterType, ModelConfig } from "./types";
import { mergeModelOutboundHeaders } from "./config/mergeHeaders";
import { joinUrl } from "./http";

/** Path for a lightweight GET that lists models (same auth as chat POST). */
export function listModelsProbePath(adapter: ModelAdapterType): string {
  switch (adapter) {
    case "ollama":
      return "api/tags";
    case "openai_compatible":
    case "deepseek":
      return "v1/models";
  }
}

export type ProbeUpstreamResult = {
  ok: boolean;
  status: number;
  message: string;
};

export type ProbeModelInput = Pick<
  ModelConfig,
  "adapter" | "baseUrl" | "timeoutMs" | "apiKey" | "apiKeyHeader" | "headers"
>;

/**
 * GET list-models endpoint with the same outbound headers as chat completions
 * (Authorization / custom api key header / config.headers).
 */
export async function probeModelUpstream(mc: ProbeModelInput): Promise<ProbeUpstreamResult> {
  const path = listModelsProbePath(mc.adapter);
  const url = joinUrl(mc.baseUrl, path);
  const timeoutMs = Math.min(mc.timeoutMs ?? 5000, 10_000);
  const merged = mergeModelOutboundHeaders(mc);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(merged ?? {}),
      },
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? "Reachable" : `HTTP ${res.status}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      message: err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err)),
    };
  } finally {
    clearTimeout(t);
  }
}
