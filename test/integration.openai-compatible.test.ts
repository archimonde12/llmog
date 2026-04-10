import { afterAll, beforeAll, describe, expect, test } from "vitest";
import Fastify from "fastify";
import { buildServer } from "../src/server";

function readCounter(
  metricsText: string,
  metricName: string,
  labels: Record<string, string>,
): number {
  const labelPairs = Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replaceAll('"', '\\"')}"`)
    .join(",");
  const re = new RegExp(
    `^${metricName}\\{${labelPairs}\\}\\s+([0-9.+-eE]+)\\s*$`,
    "m",
  );
  const m = metricsText.match(re);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

describe("integration: openai_compatible adapter", () => {
  const upstream = Fastify();
  let upstreamBaseUrl = "";
  let proxy: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    upstream.post("/v1/chat/completions", async (req: any) => {
      const body = req.body ?? {};

      if (body.stream) {
        // Minimal OpenAI-style SSE stream.
        const sse =
          `data: ${JSON.stringify({
            id: "chatcmpl_stream_test",
            object: "chat.completion.chunk",
            created: 123,
            model: body.model,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          })}\n\n` +
          `data: ${JSON.stringify({
            id: "chatcmpl_stream_test",
            object: "chat.completion.chunk",
            created: 123,
            model: body.model,
            choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
          })}\n\n` +
          `data: ${JSON.stringify({
            id: "chatcmpl_stream_test",
            object: "chat.completion.chunk",
            created: 123,
            model: body.model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          })}\n\n` +
          `data: [DONE]\n\n`;

        return new Response(sse, {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        });
      }

      return {
        id: "chatcmpl_test",
        object: "chat.completion",
        created: 123,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      };
    });

    await upstream.listen({ port: 0, host: "127.0.0.1" });
    const addr = upstream.server.address();
    const port =
      addr && typeof addr === "object" ? (addr as any).port : undefined;
    upstreamBaseUrl = `http://127.0.0.1:${port}`;

    // Build proxy against an in-memory models file by writing a temp file path.
    // We'll pass MODELS_PATH via buildServer options in this test.
    const modelsFile = {
      models: [
        {
          id: "m1",
          adapter: "openai_compatible",
          baseUrl: upstreamBaseUrl,
          model: "real-upstream-model-name",
        },
      ],
    };

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-"));
    const modelsPath = path.join(tmp, "models.json");
    await fs.writeFile(modelsPath, JSON.stringify(modelsFile), "utf8");

    proxy = await buildServer({ modelsPath, bindHost: "127.0.0.1" });
  });

  afterAll(async () => {
    await proxy?.close();
    await upstream.close();
  });

  test("proxies request and swaps model name", async () => {
    const res = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "m1",
        messages: [{ role: "user", content: "hi" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.model).toBe("real-upstream-model-name");
    expect(json.choices[0].message.content).toBe("ok");
  });

  test("proxies streaming SSE when stream=true", async () => {
    const res = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "m1",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("data:");
    expect(res.body).toContain("[DONE]");
    expect(res.body).toContain("real-upstream-model-name");
  });

  test("exposes /metrics in Prometheus format", async () => {
    const res = await proxy.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("llm_proxy_http_requests_total");
  });

  test("records token counters for non-stream responses that include usage", async () => {
    const beforeMetrics = await proxy.inject({ method: "GET", url: "/metrics" });
    const beforeIn = readCounter(
      beforeMetrics.body,
      "llm_proxy_tokens_in_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );
    const beforeOut = readCounter(
      beforeMetrics.body,
      "llm_proxy_tokens_out_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );
    const beforeTotal = readCounter(
      beforeMetrics.body,
      "llm_proxy_tokens_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );

    const res = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "m1",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(res.statusCode).toBe(200);

    const afterMetrics = await proxy.inject({ method: "GET", url: "/metrics" });
    const afterIn = readCounter(
      afterMetrics.body,
      "llm_proxy_tokens_in_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );
    const afterOut = readCounter(
      afterMetrics.body,
      "llm_proxy_tokens_out_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );
    const afterTotal = readCounter(
      afterMetrics.body,
      "llm_proxy_tokens_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );

    expect(afterIn - beforeIn).toBe(3);
    expect(afterOut - beforeOut).toBe(2);
    expect(afterTotal - beforeTotal).toBe(5);
  });

  test("best-effort records token counters for SSE streams when final usage is present", async () => {
    const beforeMetrics = await proxy.inject({ method: "GET", url: "/metrics" });
    const beforeTotal = readCounter(
      beforeMetrics.body,
      "llm_proxy_tokens_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );

    const res = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "m1",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("[DONE]");

    const afterMetrics = await proxy.inject({ method: "GET", url: "/metrics" });
    const afterTotal = readCounter(
      afterMetrics.body,
      "llm_proxy_tokens_total",
      { model_id: "m1", adapter: "openai_compatible" },
    );

    expect(afterTotal - beforeTotal).toBe(5);
  });

  test("readyz is OK (shallow and deep)", async () => {
    const shallow = await proxy.inject({ method: "GET", url: "/readyz" });
    expect(shallow.statusCode).toBe(200);
    expect(shallow.json().ok).toBe(true);

    const deep = await proxy.inject({ method: "GET", url: "/readyz?deep=1" });
    expect([200, 503]).toContain(deep.statusCode);
    const body = deep.json();
    expect(typeof body.ok).toBe("boolean");
    expect(Array.isArray(body.upstreams)).toBe(true);
    expect(body.upstreams[0].id).toBe("m1");
  });

  test("echoes x-request-id header", async () => {
    const res = await proxy.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "req_test_123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-request-id"]).toBe("req_test_123");
  });
});

