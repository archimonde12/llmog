import { describe, expect, test } from "vitest";
import { resolveModelConfig } from "../src/config";
import type { ModelsFile } from "../src/types";

describe("resolveModelConfig", () => {
  test("returns matching model", () => {
    const mf: ModelsFile = {
      models: [
        { id: "a", adapter: "ollama", baseUrl: "http://x", model: "m" },
        { id: "b", adapter: "openai_compatible", baseUrl: "http://y", model: "n" },
      ],
    };

    expect(resolveModelConfig(mf, "b").baseUrl).toBe("http://y");
  });

  test("throws 400 on unknown model", () => {
    const mf: ModelsFile = {
      models: [{ id: "a", adapter: "ollama", baseUrl: "http://x", model: "m" }],
    };

    try {
      resolveModelConfig(mf, "missing");
      throw new Error("expected throw");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(String(err.message)).toContain("Unknown model");
    }
  });
});

