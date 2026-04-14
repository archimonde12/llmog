import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverUpstreamModels } from "../src/admin/upstreamDiscover";

function mockResponse(status: number, json: unknown) {
  return Promise.resolve({
    status,
    json: () => Promise.resolve(json),
  }) as Promise<Response>;
}

describe("discoverUpstreamModels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists Ollama models from api/tags", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      mockResponse(200, { models: [{ name: "llama" }, { name: "mistral" }] }),
    );
    const r = await discoverUpstreamModels({
      adapter: "ollama",
      baseUrl: "http://127.0.0.1:11434",
    });
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["llama", "mistral"]);
  });

  it("lists OpenAI-style models from v1/models", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      mockResponse(200, { object: "list", data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
    );
    const r = await discoverUpstreamModels({
      adapter: "openai_compatible",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
    });
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer sk-test",
    });
  });

  it("returns ok false on HTTP error", async () => {
    vi.mocked(fetch).mockImplementation(() => mockResponse(401, { error: "unauthorized" }));
    const r = await discoverUpstreamModels({
      adapter: "openai_compatible",
      baseUrl: "https://example.com",
    });
    expect(r.ok).toBe(false);
    expect(r.models).toEqual([]);
  });
});
