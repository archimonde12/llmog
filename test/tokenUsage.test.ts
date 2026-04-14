import { describe, expect, test } from "vitest";
import {
  estimateTokensFromRawText,
  extractUsageFromChatCompletionResponse,
  extractUsageFromSseChunk,
  supportsOpenAiUsageShape,
  usageFromOllamaGenerateWithRawFallback,
} from "../src/observability/tokenUsage";

describe("tokenUsage", () => {
  test("supportsOpenAiUsageShape includes ollama", () => {
    expect(supportsOpenAiUsageShape("ollama")).toBe(true);
    expect(supportsOpenAiUsageShape("openai_compatible")).toBe(true);
    expect(supportsOpenAiUsageShape("deepseek")).toBe(true);
  });

  test("extractUsageFromChatCompletionResponse: ollama + OpenAI-shaped usage", () => {
    expect(
      extractUsageFromChatCompletionResponse("ollama", {
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    ).toEqual({ tokensIn: 3, tokensOut: 2, tokensTotal: 5 });
  });

  test("extractUsageFromSseChunk: ollama + OpenAI-shaped usage", () => {
    expect(
      extractUsageFromSseChunk("ollama", {
        id: "x",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    ).toEqual({ tokensIn: 3, tokensOut: 2, tokensTotal: 5 });
  });

  test("non-stream: coerce numeric strings (openai_compatible)", () => {
    expect(
      extractUsageFromChatCompletionResponse("openai_compatible", {
        usage: {
          prompt_tokens: "3",
          completion_tokens: "2",
          total_tokens: "5",
        },
      }),
    ).toEqual({ tokensIn: 3, tokensOut: 2, tokensTotal: 5 });
  });

  test("non-stream: input_tokens / output_tokens aliases (openai_compatible)", () => {
    expect(
      extractUsageFromChatCompletionResponse("openai_compatible", {
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      }),
    ).toEqual({ tokensIn: 10, tokensOut: 4, tokensTotal: 14 });
  });

  test("SSE chunk: does not use string coercion (openai_compatible)", () => {
    expect(
      extractUsageFromSseChunk("openai_compatible", {
        usage: { prompt_tokens: "3", completion_tokens: 2, total_tokens: 5 },
      }),
    ).toEqual({ tokensIn: undefined, tokensOut: 2, tokensTotal: 5 });
  });

  test("estimateTokensFromRawText: empty and non-empty", () => {
    expect(estimateTokensFromRawText("")).toBe(0);
    expect(estimateTokensFromRawText("ok")).toBe(1);
    expect(estimateTokensFromRawText("USER: hi")).toBe(2);
  });

  test("usageFromOllamaGenerateWithRawFallback: no eval counts", () => {
    expect(
      usageFromOllamaGenerateWithRawFallback({ response: "ok", done: true }, "USER: hi", "ok"),
    ).toEqual({ prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  });

  test("usageFromOllamaGenerateWithRawFallback: keeps Ollama eval when present", () => {
    expect(
      usageFromOllamaGenerateWithRawFallback(
        { done: true, prompt_eval_count: 7, eval_count: 3 },
        "USER: hi",
        "ok",
      ),
    ).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
  });

  test("usageFromOllamaGenerateWithRawFallback: partial eval fills the other side", () => {
    expect(
      usageFromOllamaGenerateWithRawFallback({ done: true, prompt_eval_count: 7 }, "USER: hi", "ok"),
    ).toEqual({ prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 });
  });
});
