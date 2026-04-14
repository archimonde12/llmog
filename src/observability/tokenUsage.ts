import type { ModelAdapterType } from "../types";

export type NormalizedTokenUsage = {
  tokensIn?: number;
  tokensOut?: number;
  tokensTotal?: number;
};

/** OpenAI-shaped usage with all fields set (for adapters that synthesize usage). */
export type OpenAiShapedUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** Best-effort token count from raw string length (~4 chars/token heuristic). Not tokenizer-accurate. */
export function estimateTokensFromRawText(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Prefer Ollama `prompt_eval_count` / `eval_count` when present; otherwise estimate from raw prompt/completion text.
 */
export function usageFromOllamaGenerateWithRawFallback(
  ollamaObj: unknown,
  promptText: string,
  completionText: string,
): OpenAiShapedUsage {
  let prompt_tokens: number | undefined;
  let completion_tokens: number | undefined;
  if (ollamaObj && typeof ollamaObj === "object") {
    const o = ollamaObj as Record<string, unknown>;
    if (typeof o.prompt_eval_count === "number" && Number.isFinite(o.prompt_eval_count)) {
      prompt_tokens = o.prompt_eval_count;
    }
    if (typeof o.eval_count === "number" && Number.isFinite(o.eval_count)) {
      completion_tokens = o.eval_count;
    }
  }
  if (typeof prompt_tokens !== "number") {
    prompt_tokens = estimateTokensFromRawText(promptText);
  }
  if (typeof completion_tokens !== "number") {
    completion_tokens = estimateTokensFromRawText(completionText);
  }
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Non-stream only: accept numeric strings and common alias keys. */
function numFromUsageField(v: unknown): number | undefined {
  const n = num(v);
  if (n !== undefined) return n;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return undefined;
    const parsed = Number(t);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function supportsOpenAiUsageShape(adapter: ModelAdapterType): boolean {
  return (
    adapter === "openai_compatible" ||
    adapter === "deepseek" ||
    adapter === "ollama"
  );
}

function extractUsageFromUsageObject(
  usage: unknown,
  mode: "non_stream" | "sse_chunk",
): NormalizedTokenUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const flexible = mode === "non_stream";
  const readIn = flexible ? numFromUsageField : num;
  const readOut = flexible ? numFromUsageField : num;
  const readTotal = flexible ? numFromUsageField : num;

  const tokensIn =
    readIn(u.prompt_tokens) ?? (flexible ? numFromUsageField(u.input_tokens) : undefined);
  const tokensOut =
    readOut(u.completion_tokens) ??
    (flexible ? numFromUsageField(u.output_tokens) : undefined);
  const tokensTotal = readTotal(u.total_tokens);

  if (
    typeof tokensIn !== "number" &&
    typeof tokensOut !== "number" &&
    typeof tokensTotal !== "number"
  ) {
    return null;
  }
  return { tokensIn, tokensOut, tokensTotal };
}

export function extractUsageFromChatCompletionResponse(
  adapter: ModelAdapterType,
  body: unknown,
): NormalizedTokenUsage | null {
  if (!body || typeof body !== "object") return null;

  if (supportsOpenAiUsageShape(adapter)) {
    const usage = (body as any).usage;
    return extractUsageFromUsageObject(usage, "non_stream");
  }

  return null;
}

export function extractUsageFromSseChunk(
  adapter: ModelAdapterType,
  chunk: unknown,
): NormalizedTokenUsage | null {
  if (!chunk || typeof chunk !== "object") return null;

  if (supportsOpenAiUsageShape(adapter)) {
    const usage = (chunk as any).usage;
    return extractUsageFromUsageObject(usage, "sse_chunk");
  }

  return null;
}
