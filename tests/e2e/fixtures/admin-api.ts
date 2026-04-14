/** Deterministic JSON for `page.route` mocks — same pixels every run. */

export const mockConfigResponse = {
  config: {
    models: [
      {
        id: "demo-model",
        adapter: "openai_compatible" as const,
        baseUrl: "http://127.0.0.1:11434",
        model: "llama-snapshot",
        timeoutMs: 60000,
      },
    ],
  },
  loadedFromPath: "/mock/models.json",
  writeTarget: "/mock/models.json",
  usedAlternateWritePath: false,
  configSource: "file",
  configGeneration: 1,
};

export const mockEnvResponse = {
  keys: ["OPENAI_API_KEY"],
  keysInDotenvFile: [] as string[],
  dotenvEntries: [] as Array<{ key: string; value: string }>,
  dotenvPath: "/mock/.env",
  dotenvSource: "mock",
};

/** Fixed epoch ms — table uses `toLocaleTimeString` (UTC + en-US in Playwright). */
const T0 = 1_704_000_000_000;

export const mockOverviewResponse = {
  req_count: 42,
  error_rate: 0.02,
  latency_p50_ms: 120,
  latency_p95_ms: 450,
  tokens_in_total: 1000,
  tokens_out_total: 2000,
  timeseries: [
    { ts: T0, tokens_in: 10, tokens_out: 20, req_count: 5, error_count: 0 },
    { ts: T0 + 60_000, tokens_in: 12, tokens_out: 18, req_count: 6, error_count: 1 },
    { ts: T0 + 120_000, tokens_in: 8, tokens_out: 25, req_count: 4, error_count: 0 },
    { ts: T0 + 180_000, tokens_in: 15, tokens_out: 30, req_count: 7, error_count: 0 },
    { ts: T0 + 240_000, tokens_in: 9, tokens_out: 22, req_count: 5, error_count: 1 },
  ],
};

export const mockLogsResponse = {
  logs: [
    {
      ts: T0,
      requestId: "req-visual-001",
      modelId: "demo-model",
      endpoint: "/v1/chat/completions",
      status: 200,
      latencyMs: 150,
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
    {
      ts: T0 + 30_000,
      requestId: "req-visual-002",
      modelId: "demo-model",
      endpoint: "/v1/chat/completions",
      status: 500,
      latencyMs: 80,
      usage: null,
    },
  ],
};

export const mockMessagesResponse = {
  messages: [
    {
      id: "msg-snapshot-1",
      ts: T0,
      modelId: "demo-model",
      requestId: "req-visual-001",
      endpoint: "/v1/chat/completions",
      role: "user" as const,
      rawMessageJson: { role: "user", content: "Hello snapshot" },
    },
  ],
};

/** OpenAI-style model list for Playground (`GET /v1/models`). */
export const mockV1ModelsResponse = {
  object: "list",
  data: [
    {
      id: "demo-model",
      object: "model",
      created: 1_704_000_000,
      owned_by: "llmog",
    },
  ],
};

/** Deterministic templates for `GET /admin/playground/templates` (Playground sidebar). */
export const mockPlaygroundTemplatesResponse = {
  templates: [
    {
      id: "tpl-vrt-001",
      name: "Snapshot template",
      systemPrompt: "You are a helpful assistant for visual regression.",
      temperature: 0.7,
      max_tokens: 256,
      defaultModelId: "demo-model",
    },
  ],
  loadedFromPath: "/mock/playground-templates.json",
  usedAlternateWritePath: false,
};
