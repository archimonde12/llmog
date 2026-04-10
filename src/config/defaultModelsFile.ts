import type { ModelsFile } from "./schema";

/** Minimal valid config used by `llm-proxy init -y` and auto-create on first start. */
export function createDefaultModelsFile(): ModelsFile {
  return {
    models: [
      {
        id: "ollama-llama3",
        adapter: "ollama",
        baseUrl: "http://localhost:11434",
        model: "llama3",
      },
    ],
  };
}
