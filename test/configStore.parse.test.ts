import { describe, expect, test } from "vitest";
import { parseModelsFileJson } from "../src/admin/configStore";

describe("parseModelsFileJson", () => {
  test("accepts valid config", () => {
    const res = parseModelsFileJson({
      models: [
        {
          id: "m1",
          adapter: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          model: "x",
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.models[0].id).toBe("m1");
  });

  test("returns issues on invalid URL", () => {
    const res = parseModelsFileJson({
      models: [
        {
          id: "m1",
          adapter: "ollama",
          baseUrl: "not-a-url",
          model: "x",
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.path.includes("baseUrl"))).toBe(true);
  });
});
