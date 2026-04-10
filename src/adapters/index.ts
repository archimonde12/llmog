import { ModelConfig } from "../types";
import { LlmAdapter } from "./base";
import { createDeepseekAdapter } from "./deepseek";
import { createOllamaAdapter } from "./ollama";
import { createOpenAICompatibleAdapter } from "./openaiCompatible";

export function createAdapter(cfg: ModelConfig): LlmAdapter {
  switch (cfg.adapter) {
    case "deepseek":
      return createDeepseekAdapter(cfg);
    case "ollama":
      return createOllamaAdapter(cfg);
    case "openai_compatible":
      return createOpenAICompatibleAdapter(cfg);
    default: {
      const neverCfg: never = cfg.adapter;
      throw new Error(`Unsupported adapter: ${neverCfg}`);
    }
  }
}

