import { describe, expect, test } from "vitest";
import { joinUrl } from "../src/http";

describe("joinUrl", () => {
  test("preserves path prefix on base (OpenRouter-style /api)", () => {
    expect(joinUrl("https://openrouter.ai/api", "v1/chat/completions")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  test("origin-only base", () => {
    expect(joinUrl("http://127.0.0.1:8000", "v1/chat/completions")).toBe(
      "http://127.0.0.1:8000/v1/chat/completions",
    );
  });

  test("strips duplicate slashes from base trailing /", () => {
    expect(joinUrl("http://localhost:11434/", "api/generate")).toBe(
      "http://localhost:11434/api/generate",
    );
  });
});
