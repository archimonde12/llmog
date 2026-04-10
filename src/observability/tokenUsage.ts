import type { ModelAdapterType } from "../types";

export type NormalizedTokenUsage = {
  tokensIn?: number;
  tokensOut?: number;
  tokensTotal?: number;
};

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function extractUsageFromChatCompletionResponse(
  adapter: ModelAdapterType,
  body: unknown,
): NormalizedTokenUsage | null {
  if (!body || typeof body !== "object") return null;

  if (adapter === "openai_compatible" || adapter === "deepseek") {
    const usage = (body as any).usage;
    if (!usage || typeof usage !== "object") return null;
    const tokensIn = num((usage as any).prompt_tokens);
    const tokensOut = num((usage as any).completion_tokens);
    const tokensTotal = num((usage as any).total_tokens);
    if (
      typeof tokensIn !== "number" &&
      typeof tokensOut !== "number" &&
      typeof tokensTotal !== "number"
    ) {
      return null;
    }
    return { tokensIn, tokensOut, tokensTotal };
  }

  // Best-effort only; adapters may not expose usage consistently.
  return null;
}

export function extractUsageFromSseChunk(
  adapter: ModelAdapterType,
  chunk: unknown,
): NormalizedTokenUsage | null {
  if (!chunk || typeof chunk !== "object") return null;

  if (adapter === "openai_compatible" || adapter === "deepseek") {
    const usage = (chunk as any).usage;
    if (!usage || typeof usage !== "object") return null;
    const tokensIn = num((usage as any).prompt_tokens);
    const tokensOut = num((usage as any).completion_tokens);
    const tokensTotal = num((usage as any).total_tokens);
    if (
      typeof tokensIn !== "number" &&
      typeof tokensOut !== "number" &&
      typeof tokensTotal !== "number"
    ) {
      return null;
    }
    return { tokensIn, tokensOut, tokensTotal };
  }

  return null;
}

