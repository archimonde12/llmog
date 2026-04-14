import { describe, expect, test } from "vitest";
import { parsePlaygroundTemplatesJson } from "../src/admin/playgroundTemplatesStore";

describe("parsePlaygroundTemplatesJson", () => {
  test("accepts valid file", () => {
    const res = parsePlaygroundTemplatesJson({
      templates: [
        {
          id: "a",
          name: "T",
          systemPrompt: "be nice",
          temperature: 0.7,
          max_tokens: 256,
          defaultModelId: "m1",
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.templates[0].name).toBe("T");
  });

  test("rejects duplicate template ids", () => {
    const res = parsePlaygroundTemplatesJson({
      templates: [
        { id: "x", name: "A", systemPrompt: "" },
        { id: "x", name: "B", systemPrompt: "" },
      ],
    });
    expect(res.ok).toBe(false);
  });
});
