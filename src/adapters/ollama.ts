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

function messagesToPrompt(req: OpenAIChatCompletionsRequest): string {
  // Simple, predictable mapping: keep roles inline for local models.
  return req.messages
    .map((m) => {
      const content = Array.isArray(m.content) ? "" : (m.content ?? "");
      return `${m.role.toUpperCase()}: ${content}`;
    })
    .join("\n");
}

export function createOllamaAdapter(cfg: ModelConfig): LlmAdapter {
  const outboundHeaders = mergeModelOutboundHeaders(cfg);

  return {
    async chatCompletions(req: OpenAIChatCompletionsRequest) {
      const url = joinUrl(cfg.baseUrl, "api/generate");
      const body = {
        model: cfg.model,
        prompt: messagesToPrompt(req),
        stream: false,
        options: {
          temperature: req.temperature,
          num_predict: req.max_tokens,
        },
      };

      const res = await postJson<any>(url, body, {
        headers: outboundHeaders,
        timeoutMs: cfg.timeoutMs,
      });

      // Convert Ollama's response into an OpenAI-ish shape so clients
      // can consistently consume `/v1/chat/completions`.
      const content =
        res.json && typeof res.json === "object" && "response" in res.json
          ? String((res.json as any).response ?? "")
          : "";

      const openaiLike = {
        id: `chatcmpl_ollama_${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: cfg.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
      };

      return {
        status: res.status,
        headers: headersToRecord(res.headers),
        body: openaiLike,
      };
    },

    async chatCompletionsStream(req: OpenAIChatCompletionsRequest) {
      const url = joinUrl(cfg.baseUrl, "api/generate");

      const body = {
        model: cfg.model,
        prompt: messagesToPrompt(req),
        stream: true,
        options: {
          temperature: req.temperature,
          num_predict: req.max_tokens,
        },
      };

      const upstream = await postJsonStream(url, body, {
        headers: outboundHeaders,
        timeoutMs: cfg.timeoutMs,
      });

      // Ollama returns NDJSON objects per line:
      // { response: "...", done: boolean, ... }
      // Convert to OpenAI ChatCompletions SSE (chat.completion.chunk).
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const id = `chatcmpl_ollama_${Date.now()}`;
          const created = Math.floor(Date.now() / 1000);
          let sentRole = false;
          let buffer = "";

          const writeSse = (data: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          try {
            if (!upstream.body) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    error: { message: "Upstream returned empty body" },
                  })}\n\n`,
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }

            const reader = upstream.body.getReader();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (!value) continue;

              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;

                let obj: any;
                try {
                  obj = JSON.parse(line);
                } catch {
                  continue;
                }

                if (!sentRole) {
                  sentRole = true;
                  writeSse({
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: cfg.model,
                    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
                  });
                }

                const deltaText =
                  obj && typeof obj === "object" && "response" in obj
                    ? String(obj.response ?? "")
                    : "";

                if (deltaText) {
                  writeSse({
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: cfg.model,
                    choices: [
                      { index: 0, delta: { content: deltaText }, finish_reason: null },
                    ],
                  });
                }

                if (obj?.done) {
                  writeSse({
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: cfg.model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  });
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                  return;
                }
              }
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (e: any) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: { message: e?.message ?? "Stream error" } })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        },
      });

      return {
        status: upstream.status,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
        body: stream,
      };
    },
  };
}

