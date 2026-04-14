import { afterAll, beforeAll, describe, expect, test } from "vitest";
import Fastify from "fastify";
import { buildServer } from "../src/server";

describe("integration: ollama adapter token usage → admin logs", () => {
  const upstream = Fastify();
  let upstreamBaseUrl = "";
  let proxy: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    upstream.post("/api/generate", async (req: any) => {
      const body = req.body ?? {};
      const noEval = body.model === "llama-no-eval";

      if (body.stream) {
        const finalChunk = noEval
          ? { response: "", done: true }
          : {
              response: "",
              done: true,
              prompt_eval_count: 7,
              eval_count: 3,
            };
        const ndjson =
          [
            JSON.stringify({ response: "", done: false }),
            JSON.stringify({ response: "ok", done: false }),
            JSON.stringify(finalChunk),
          ].join("\n") + "\n";

        return new Response(ndjson, {
          headers: { "content-type": "application/x-ndjson" },
        });
      }

      if (noEval) {
        return { response: "ok", done: true };
      }
      return {
        response: "ok",
        done: true,
        prompt_eval_count: 7,
        eval_count: 3,
      };
    });

    await upstream.listen({ port: 0, host: "127.0.0.1" });
    const addr = upstream.server.address();
    const port =
      addr && typeof addr === "object" ? (addr as any).port : undefined;
    upstreamBaseUrl = `http://127.0.0.1:${port}`;

    const modelsFile = {
      models: [
        {
          id: "ollama-m1",
          adapter: "ollama",
          baseUrl: upstreamBaseUrl,
          model: "llama-local",
        },
        {
          id: "ollama-m2-no-eval",
          adapter: "ollama",
          baseUrl: upstreamBaseUrl,
          model: "llama-no-eval",
        },
      ],
    };

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-ollama-"));
    const modelsPath = path.join(tmp, "models.json");
    await fs.writeFile(modelsPath, JSON.stringify(modelsFile), "utf8");

    proxy = await buildServer({ modelsPath, bindHost: "127.0.0.1" });
  });

  afterAll(async () => {
    await proxy?.close();
    await upstream.close();
  });

  test("non-stream: GET /admin/logs/models includes usage from Ollama eval counts", async () => {
    const chat = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "ollama-m1",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(chat.statusCode).toBe(200);

    const logsRes = await proxy.inject({
      method: "GET",
      url: "/admin/logs/models?range=24h&limit=50",
    });
    expect(logsRes.statusCode).toBe(200);
    const { logs } = logsRes.json() as {
      logs: Array<{ modelId: string; usage: Record<string, number> | null }>;
    };
    const row = logs.find((l) => l.modelId === "ollama-m1");
    expect(row).toBeDefined();
    expect(row!.usage?.prompt_tokens).toBe(7);
    expect(row!.usage?.completion_tokens).toBe(3);
    expect(row!.usage?.total_tokens).toBe(10);
  });

  test("stream: admin logs include usage from final Ollama chunk", async () => {
    const chat = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "ollama-m1",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.headers["content-type"]).toContain("text/event-stream");
    expect(chat.body).toContain("[DONE]");

    const logsRes = await proxy.inject({
      method: "GET",
      url: "/admin/logs/models?range=24h&limit=50",
    });
    expect(logsRes.statusCode).toBe(200);
    const { logs } = logsRes.json() as {
      logs: Array<{ modelId: string; usage: Record<string, number> | null }>;
    };
    const row = logs.find((l) => l.modelId === "ollama-m1");
    expect(row).toBeDefined();
    expect(row!.usage?.prompt_tokens).toBe(7);
    expect(row!.usage?.completion_tokens).toBe(3);
    expect(row!.usage?.total_tokens).toBe(10);
  });

  test("non-stream: raw-text estimate when Ollama omits eval counts", async () => {
    const chat = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "ollama-m2-no-eval",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(chat.statusCode).toBe(200);

    const logsRes = await proxy.inject({
      method: "GET",
      url: "/admin/logs/models?range=24h&limit=50",
    });
    expect(logsRes.statusCode).toBe(200);
    const { logs } = logsRes.json() as {
      logs: Array<{ modelId: string; usage: Record<string, number> | null }>;
    };
    const row = logs.find((l) => l.modelId === "ollama-m2-no-eval");
    expect(row).toBeDefined();
    expect(row!.usage?.prompt_tokens).toBe(2);
    expect(row!.usage?.completion_tokens).toBe(1);
    expect(row!.usage?.total_tokens).toBe(3);
  });

  test("stream: raw-text estimate when Ollama omits eval counts", async () => {
    const chat = await proxy.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "ollama-m2-no-eval",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.headers["content-type"]).toContain("text/event-stream");

    const logsRes = await proxy.inject({
      method: "GET",
      url: "/admin/logs/models?range=24h&limit=50",
    });
    expect(logsRes.statusCode).toBe(200);
    const { logs } = logsRes.json() as {
      logs: Array<{ modelId: string; usage: Record<string, number> | null }>;
    };
    const row = logs.find((l) => l.modelId === "ollama-m2-no-eval");
    expect(row).toBeDefined();
    expect(row!.usage?.prompt_tokens).toBe(2);
    expect(row!.usage?.completion_tokens).toBe(1);
    expect(row!.usage?.total_tokens).toBe(3);
  });
});
