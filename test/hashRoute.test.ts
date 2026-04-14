import { describe, it, expect } from "vitest";
import { parseAppHash } from "../ui/src/lib/hashRoute";

describe("parseAppHash", () => {
  it("parses playground with model query", () => {
    const r = parseAppHash("#/playground?model=demo-model");
    expect(r.name).toBe("playground");
    expect(r.query.model).toBe("demo-model");
  });

  it("parses path without query", () => {
    const r = parseAppHash("#/configuration");
    expect(r.name).toBe("configuration");
    expect(Object.keys(r.query).length).toBe(0);
  });

  it("parses probe route", () => {
    const r = parseAppHash("#/probe");
    expect(r.name).toBe("probe");
  });
});
