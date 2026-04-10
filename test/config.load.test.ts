import { afterEach, describe, expect, test, vi } from "vitest";
import {
  loadModelsFile,
  loadModelsFileFromPath,
  loadModelsFileFromPathAsStored,
  resolveExistingModelsPath,
} from "../src/config/load";
import {
  canonicalUserModelsPath,
  legacyProxyUserModelsPath,
  legacyUserModelsPath,
} from "../src/config/paths";

describe("config loader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("validates and reports duplicate ids with paths", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-config-"));
    const p = path.join(tmp, "models.json");
    await fs.writeFile(
      p,
      JSON.stringify({
        models: [
          { id: "a", adapter: "ollama", baseUrl: "http://localhost:11434", model: "llama3" },
          { id: "a", adapter: "ollama", baseUrl: "http://localhost:11434", model: "llama3" },
        ],
      }),
      "utf8",
    );

    try {
      await loadModelsFileFromPath(p);
      throw new Error("expected throw");
    } catch (err: any) {
      expect(String(err.message)).toContain("models[1].id");
      expect(String(err.message)).toContain("Duplicate id");
    }
  });

  test("resolveExistingModelsPath prefers canonical user models path", async () => {
    const resolved = await resolveExistingModelsPath();
    expect(resolved.kind).toBe("user_default");
    expect(resolved.path).toBe(canonicalUserModelsPath());
  });

  test("rejects apiKeyHeader without apiKey", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-apikey-"));
    const p = path.join(tmp, "models.json");
    await fs.writeFile(
      p,
      JSON.stringify({
        models: [
          {
            id: "a",
            adapter: "ollama",
            baseUrl: "http://localhost:11434",
            model: "llama3",
            apiKeyHeader: "x-api-key",
          },
        ],
      }),
      "utf8",
    );

    try {
      await loadModelsFileFromPath(p);
      throw new Error("expected throw");
    } catch (err: any) {
      expect(String(err.message)).toContain("apiKey");
    }
  });

  test("loadModelsFileFromPathAsStored keeps ${ENV} in apiKey", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-as-stored-"));
    const p = path.join(tmp, "models.json");
    const secret = "sk-test-secret-do-not-leak";
    process.env.MY_PROXY_TEST_KEY = secret;
    await fs.writeFile(
      p,
      JSON.stringify({
        models: [
          {
            id: "a",
            adapter: "ollama",
            baseUrl: "http://localhost:11434",
            model: "llama3",
            apiKey: "${MY_PROXY_TEST_KEY}",
          },
        ],
      }),
      "utf8",
    );

    try {
      const stored = await loadModelsFileFromPathAsStored(p);
      expect(stored.models[0]!.apiKey).toBe("${MY_PROXY_TEST_KEY}");

      const resolved = await loadModelsFileFromPath(p);
      expect(resolved.models[0]!.apiKey).toBe(secret);
    } finally {
      delete process.env.MY_PROXY_TEST_KEY;
    }
  });

  test("loadModelsFile creates starter user models.json when no config exists", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-autocreate-"));
    const fakeHome = path.join(tmp, "home");
    await fs.mkdir(fakeHome, { recursive: true });
    vi.stubEnv("HOME", fakeHome);

    const cwd = path.join(tmp, "project");
    await fs.mkdir(cwd, { recursive: true });
    const canonicalPath = path.join(fakeHome, ".config", "llmog", "models.json");

    const loaded = await loadModelsFile({ cwd });
    expect(loaded.createdDefaultFile).toBe(true);
    expect(loaded.source.kind).toBe("user_default");
    expect(loaded.source.path).toBe(canonicalPath);
    expect(loaded.modelsFile.models).toHaveLength(1);
    expect(loaded.modelsFile.models[0]!.id).toBe("ollama-llama3");

    const raw = await fs.readFile(canonicalPath, "utf8");
    expect(raw).toContain("ollama-llama3");
  });

  test("loadModelsFile creates starter file at explicit --models path when missing", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-cli-create-"));
    const target = path.join(tmp, "custom-models.json");

    const loaded = await loadModelsFile({ cliFlagPath: target });
    expect(loaded.createdDefaultFile).toBe(true);
    expect(loaded.source.kind).toBe("cli_flag");
    expect(loaded.source.path).toBe(path.resolve(target));
    await fs.access(target);
  });

  test("canonicalUserModelsPath returns path under ~/.config/llmog", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const canonical = canonicalUserModelsPath();
    expect(canonical).toBe(path.join(os.homedir(), ".config", "llmog", "models.json"));
  });

  test("legacyProxyUserModelsPath returns path under ~/.config/llm-proxy", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const legacyProxy = legacyProxyUserModelsPath();
    expect(legacyProxy).toBe(path.join(os.homedir(), ".config", "llm-proxy", "models.json"));
  });

  test("legacyUserModelsPath returns path under ~/.config/llm-open-gateway", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const legacy = legacyUserModelsPath();
    expect(legacy).toBe(path.join(os.homedir(), ".config", "llm-open-gateway", "models.json"));
  });

  test("resolveExistingModelsPath prefers canonical over legacy user path", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-canonical-"));
    const fakeHome = path.join(tmp, "home");

    // Create both canonical and legacy config files
    const canonicalDir = path.join(fakeHome, ".config", "llmog");
    const legacyDir = path.join(fakeHome, ".config", "llm-open-gateway");
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(canonicalDir, "models.json"), JSON.stringify({ models: [] }), "utf8");
    await fs.writeFile(path.join(legacyDir, "models.json"), JSON.stringify({ models: [] }), "utf8");

    vi.stubEnv("HOME", fakeHome);
    const cwd = path.join(tmp, "project");
    await fs.mkdir(cwd, { recursive: true });

    const resolved = await resolveExistingModelsPath({ cwd });
    expect(resolved.kind).toBe("user_default");
    expect(resolved.path).toContain(path.join(".config", "llmog", "models.json"));
  });

  test("resolveExistingModelsPath falls back to legacy llm-proxy path when canonical missing", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-legacy-"));
    const fakeHome = path.join(tmp, "home");

    // Create only legacy llm-proxy config file
    const legacyProxyDir = path.join(fakeHome, ".config", "llm-proxy");
    await fs.mkdir(legacyProxyDir, { recursive: true });
    await fs.writeFile(path.join(legacyProxyDir, "models.json"), JSON.stringify({ models: [] }), "utf8");

    vi.stubEnv("HOME", fakeHome);
    const cwd = path.join(tmp, "project");
    await fs.mkdir(cwd, { recursive: true });

    const resolved = await resolveExistingModelsPath({ cwd });
    expect(resolved.kind).toBe("user_default");
    expect(resolved.path).toContain(path.join(".config", "llm-proxy", "models.json"));
  });

  test("resolveExistingModelsPath falls back to legacy llm-open-gateway path when canonical and llm-proxy are missing", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-legacy-open-gateway-"));
    const fakeHome = path.join(tmp, "home");

    // Create only legacy llm-open-gateway config file
    const legacyDir = path.join(fakeHome, ".config", "llm-open-gateway");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, "models.json"), JSON.stringify({ models: [] }), "utf8");

    vi.stubEnv("HOME", fakeHome);
    const cwd = path.join(tmp, "project");
    await fs.mkdir(cwd, { recursive: true });

    const resolved = await resolveExistingModelsPath({ cwd });
    expect(resolved.kind).toBe("user_default");
    expect(resolved.path).toContain(path.join(".config", "llm-open-gateway", "models.json"));
  });

  test("loadModelsFile uses legacy path when only legacy file exists", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "llm-proxy-legacy-load-"));
    const fakeHome = path.join(tmp, "home");

    const legacyDir = path.join(fakeHome, ".config", "llm-open-gateway");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, "models.json"),
      JSON.stringify({
        models: [{ id: "legacy-model", adapter: "ollama", baseUrl: "http://localhost:11434", model: "llama3" }],
      }),
      "utf8",
    );

    vi.stubEnv("HOME", fakeHome);
    const cwd = path.join(tmp, "project");
    await fs.mkdir(cwd, { recursive: true });

    const loaded = await loadModelsFile({ cwd });
    expect(loaded.source.kind).toBe("user_default");
    expect(loaded.source.path).toContain("llm-open-gateway");
    expect(loaded.modelsFile.models[0]!.id).toBe("legacy-model");
  });
});

