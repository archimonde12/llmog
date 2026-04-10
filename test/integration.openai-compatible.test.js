"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fastify_1 = __importDefault(require("fastify"));
const server_1 = require("../src/server");
(0, vitest_1.describe)("integration: openai_compatible adapter", () => {
    const upstream = (0, fastify_1.default)();
    let upstreamBaseUrl = "";
    let proxy;
    (0, vitest_1.beforeAll)(async () => {
        upstream.post("/v1/chat/completions", async (req) => {
            const body = req.body ?? {};
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
            };
        });
        await upstream.listen({ port: 0, host: "127.0.0.1" });
        const addr = upstream.server.address();
        const port = addr && typeof addr === "object" ? addr.port : undefined;
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
        proxy = await (0, server_1.buildServer)({ modelsPath });
    });
    (0, vitest_1.afterAll)(async () => {
        await proxy?.close();
        await upstream.close();
    });
    (0, vitest_1.test)("proxies request and swaps model name", async () => {
        const res = await proxy.inject({
            method: "POST",
            url: "/v1/chat/completions",
            payload: {
                model: "m1",
                messages: [{ role: "user", content: "hi" }],
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const json = res.json();
        (0, vitest_1.expect)(json.model).toBe("real-upstream-model-name");
        (0, vitest_1.expect)(json.choices[0].message.content).toBe("ok");
    });
});
