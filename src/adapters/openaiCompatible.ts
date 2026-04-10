import { LlmAdapter } from "./base";
import { mergeModelOutboundHeaders } from "../config/mergeHeaders";
import { joinUrl, postJson, postJsonStream } from "../http";
import { ModelConfig, OpenAIChatCompletionsRequest } from "../types";

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function createOpenAICompatibleAdapter(cfg: ModelConfig): LlmAdapter {
  const outboundHeaders = mergeModelOutboundHeaders(cfg);

  return {
    async chatCompletions(req: OpenAIChatCompletionsRequest) {
      const url = joinUrl(cfg.baseUrl, "v1/chat/completions");
      const forwarded: OpenAIChatCompletionsRequest = {
        ...req,
        model: cfg.model,
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

