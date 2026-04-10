import { LlmAdapter } from "./base";
import { mergeModelOutboundHeaders } from "../config/mergeHeaders";
import { joinUrl, postJson, postJsonStream } from "../http";
import { ModelConfig, OpenAIChatCompletionsRequest, OpenAIChatMessage } from "../types";

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function contentToText(content: OpenAIChatMessage["content"]): string | null {
  if (content === null || content === undefined) return null;
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const anyBlock = block as any;
      if (anyBlock.type !== "text") continue;
      if (typeof anyBlock.text === "string") parts.push(anyBlock.text);
    }
    return parts.join("\n");
  }

  return String(content);
}

function normalizeMessages(messages: OpenAIChatMessage[]): OpenAIChatMessage[] {
  return messages.map((m) => {
    const normalized = contentToText((m as any).content);
    return { ...m, content: normalized };
  });
}

export function createDeepseekAdapter(cfg: ModelConfig): LlmAdapter {
  const outboundHeaders = mergeModelOutboundHeaders(cfg);

  return {
    async chatCompletions(req: OpenAIChatCompletionsRequest) {
      const url = joinUrl(cfg.baseUrl, "v1/chat/completions");
      const forwarded: OpenAIChatCompletionsRequest = {
        ...req,
        model: cfg.model,
        messages: normalizeMessages(req.messages as any),
      };

      const res = await postJson<unknown>(url, forwarded, {
        headers: outboundHeaders,
        timeoutMs: cfg.timeoutMs,
      });

      return {
        status: res.status,
        headers: headersToRecord(res.headers),
        body: res.json,
      };
    },

    async chatCompletionsStream(req: OpenAIChatCompletionsRequest) {
      const url = joinUrl(cfg.baseUrl, "v1/chat/completions");
      const forwarded: OpenAIChatCompletionsRequest = {
        ...req,
        model: cfg.model,
        stream: true,
        messages: normalizeMessages(req.messages as any),
      };

      const res = await postJsonStream(url, forwarded, {
        headers: outboundHeaders,
        timeoutMs: cfg.timeoutMs,
      });

      return {
        status: res.status,
        headers: headersToRecord(res.headers),
        body: res.body,
      };
    },
  };
}

