export type ModelAdapterType = "ollama" | "openai_compatible" | "deepseek";

export type ModelConfig = {
  id: string;
  adapter: ModelAdapterType;
  baseUrl: string;
  model: string;
  /** Default: `Authorization: Bearer <apiKey>`; set `apiKeyHeader` (e.g. `x-api-key`) to send the raw key there instead. */
  apiKey?: string;
  apiKeyHeader?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type ModelsFile = {
  models: ModelConfig[];
};

export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  // Some clients send OpenAI-style "content parts" arrays; adapters may normalize upstream.
  content: string | null | Array<unknown>;
  name?: string;
};

export type OpenAIChatCompletionsRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
};
