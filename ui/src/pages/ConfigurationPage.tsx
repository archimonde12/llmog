import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "../components/Drawer";
import { apiGet, apiPost, apiPut } from "../lib/api";

type Adapter = "ollama" | "openai_compatible" | "deepseek";

type ModelConfig = {
  id: string;
  adapter: Adapter;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  apiKey?: string;
  apiKeyHeader?: string;
  headers?: Record<string, string>;
  /** UI-only stable key (not persisted) */
  _uiKey?: string;
};

type ModelsFile = { models: ModelConfig[] };

type ConfigResponse = {
  config: ModelsFile;
  loadedFromPath: string;
  writeTarget: string;
  usedAlternateWritePath: boolean;
  configSource: string;
  configGeneration: number;
};

type EnvResponse = {
  keys: string[];
  keysInDotenvFile?: string[];
  dotenvEntries?: Array<{ key: string; value: string }>;
  dotenvPath: string;
  dotenvSource: string;
};

type PutEnvResponse = {
  ok: boolean;
  writtenTo: string;
  changedKeys: string[];
  note?: string;
};

type PutConfigResponse = {
  ok: boolean;
  writtenTo: string;
  usedAlternateWritePath: boolean;
  configGeneration: number;
  hint?: string;
};

type TestResp = { ok: boolean; status: number; message: string; baseUrl: string };

const LS_TEST_STATUS = "llmog:config:testStatus:v1";
const RELOAD_COOLDOWN_MS = 2000;
const TEST_ALL_COOLDOWN_MS = 2000;
const AUTO_TEST_INTERVAL_MS = 5 * 60_000;
const SHORT_ERR_LEN = 36;

function shallowClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isEnvRef(s: string | undefined): s is string {
  if (!s) return false;
  return /^\$\{[A-Z0-9_]+\}$/.test(s.trim());
}

function envNameFromRef(ref: string): string {
  const m = /^\$\{([A-Z0-9_]+)\}$/.exec(ref.trim());
  return m?.[1] ?? "";
}

function mkNewModel(): ModelConfig {
  return {
    id: "",
    adapter: "openai_compatible",
    baseUrl: "",
    model: "",
    timeoutMs: undefined,
  };
}

function dedupeModels(models: ModelConfig[]): { ok: true } | { ok: false; message: string } {
  const seen = new Set<string>();
  for (const m of models) {
    const id = (m.id ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) return { ok: false, message: `Duplicate model id '${id}'` };
    seen.add(id);
  }
  return { ok: true };
}

/** Stable JSON for dirty-check (drops UI-only fields). */
function fingerprintModels(ms: ModelConfig[]): string {
  const rows = ms.map(({ _uiKey, ...rest }) => rest);
  rows.sort((a, b) => {
    const c = (a.id || "").localeCompare(b.id || "");
    if (c !== 0) return c;
    return (a.baseUrl || "").localeCompare(b.baseUrl || "");
  });
  return JSON.stringify(rows);
}

function mergeServerWithDrafts(prev: ModelConfig[], serverModels: ModelConfig[]): ModelConfig[] {
  const fromServer = (serverModels ?? []).map((m) => ({ ...m, _uiKey: m.id }));
  const drafts = prev.filter((m) => String(m._uiKey ?? "").startsWith("__new__"));
  const seen = new Set(fromServer.map((m) => m.id));
  const filteredDrafts = drafts.filter((d) => {
    const id = (d.id ?? "").trim();
    return !id || !seen.has(id);
  });
  return [...filteredDrafts, ...fromServer];
}

function pickSelectionKey(merged: ModelConfig[], prev: string): string {
  const keys = merged.map((m) => m._uiKey ?? m.id);
  if (prev && keys.includes(prev)) return prev;
  return keys[0] ?? "";
}

function shortErr(msg: string): string {
  const t = msg.trim().replace(/\s+/g, " ");
  if (t.length <= SHORT_ERR_LEN) return t;
  return `${t.slice(0, SHORT_ERR_LEN - 1)}…`;
}

function segmentToEnvToken(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Suggested env var for API key: {ID}_{ADAPTER}_API_KEY */
function suggestApiKeyEnvName(id: string, adapter: string): string {
  const a = segmentToEnvToken(id) || "MODEL";
  const b = segmentToEnvToken(adapter) || "ADAPTER";
  return `${a}_${b}_API_KEY`;
}

function nextCopyEnvKey(baseKey: string, used: Set<string>): string {
  let candidate = `${baseKey}_COPY`;
  if (!used.has(candidate)) return candidate;
  let n = 2;
  while (used.has(`${baseKey}_COPY${n}`)) n++;
  return `${baseKey}_COPY${n}`;
}

type RowStatus = {
  loading?: boolean;
  ok?: boolean;
  message: string;
  shortErr?: string;
};

function persistTestStatus(map: Record<string, RowStatus>) {
  try {
    const slim: Record<string, { ok: boolean; message: string; shortErr?: string; at: number }> = {};
    const now = Date.now();
    for (const [k, v] of Object.entries(map)) {
      if (v.loading || v.ok === undefined) continue;
      slim[k] = { ok: v.ok, message: v.message, shortErr: v.shortErr, at: now };
    }
    localStorage.setItem(LS_TEST_STATUS, JSON.stringify({ v: 1, byRow: slim, savedAt: now }));
  } catch {
    // ignore quota / private mode
  }
}

function loadPersistedTestStatus(): Record<string, RowStatus> {
  try {
    const raw = localStorage.getItem(LS_TEST_STATUS);
    if (!raw) return {};
    const p = JSON.parse(raw) as { byRow?: Record<string, { ok: boolean; message: string; shortErr?: string }> };
    const out: Record<string, RowStatus> = {};
    if (!p?.byRow) return out;
    for (const [k, v] of Object.entries(p.byRow)) {
      out[k] = { ok: v.ok, message: v.message, shortErr: v.shortErr };
    }
    return out;
  } catch {
    return {};
  }
}

/** JSON as persisted in models.json (no _uiKey; apiKey only as stored reference). */
function modelToFileJson(m: ModelConfig): Record<string, unknown> {
  const copy = shallowClone(m) as Record<string, unknown>;
  delete copy._uiKey;
  const id = String(copy.id ?? "").trim();
  if (!id) delete copy.id;
  if (copy.timeoutMs != null && !Number.isFinite(Number(copy.timeoutMs))) delete copy.timeoutMs;
  if (!copy.apiKey) delete copy.apiKey;
  if (!copy.apiKeyHeader) delete copy.apiKeyHeader;
  if (copy.headers && typeof copy.headers === "object" && Object.keys(copy.headers as object).length === 0) delete copy.headers;
  return copy;
}

export function ConfigurationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [meta, setMeta] = useState<Pick<
    ConfigResponse,
    "loadedFromPath" | "writeTarget" | "usedAlternateWritePath" | "configGeneration" | "configSource"
  > | null>(null);

  const [models, setModels] = useState<ModelConfig[]>([]);
  const [baseline, setBaseline] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("");

  const [env, setEnv] = useState<EnvResponse | null>(null);
  const [envOpen, setEnvOpen] = useState(false);
  const [envKey, setEnvKey] = useState("");
  const [envVal, setEnvVal] = useState("");
  const [envEditRows, setEnvEditRows] = useState<Array<{ key: string; value: string }>>([]);
  const [envRowOpenKey, setEnvRowOpenKey] = useState<string | null>(null);
  const [envBusy, setEnvBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const [apiKeyMode, setApiKeyMode] = useState<"none" | "env">("none");

  const [fullConfigText, setFullConfigText] = useState("");

  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});
  const [rowTesting, setRowTesting] = useState<string | null>(null);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [testAllCooldown, setTestAllCooldown] = useState(false);
  const [reloadCooldown, setReloadCooldown] = useState(false);

  const modelsRef = useRef<ModelConfig[]>([]);
  const testAllInFlight = useRef(false);
  const testAllCooldownRef = useRef(false);
  const reloadInFlight = useRef(false);
  const lastAutoTestGeneration = useRef<number | null>(null);

  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

  const selected = useMemo(
    () => models.find((m) => (m._uiKey ?? m.id) === selectedKey) ?? null,
    [models, selectedKey],
  );

  /** Sync API key UI mode from row when selection or server config generation changes. */
  useEffect(() => {
    const cur = modelsRef.current.find((m) => (m._uiKey ?? m.id) === selectedKey) ?? null;
    if (!cur) {
      setApiKeyMode("none");
      return;
    }
    const ref = cur.apiKey?.trim();
    if (!ref) {
      setApiKeyMode("none");
    } else if (isEnvRef(ref)) {
      setApiKeyMode("env");
    } else {
      setApiKeyMode("none");
    }
  }, [selectedKey, meta?.configGeneration]);

  const dirty = useMemo(() => fingerprintModels(models) !== baseline, [models, baseline]);

  const normalizeBeforeSave = useCallback((ms: ModelConfig[]): ModelConfig[] => {
    return ms
      .map((m) => {
        const copy = shallowClone(m);
        delete (copy as any)._uiKey;
        copy.id = String(copy.id ?? "").trim();
        copy.baseUrl = String(copy.baseUrl ?? "").trim();
        copy.model = String(copy.model ?? "").trim();
        if (copy.timeoutMs != null && !Number.isFinite(Number(copy.timeoutMs))) delete copy.timeoutMs;
        if (!copy.apiKey) delete copy.apiKey;
        if (!copy.apiKeyHeader) delete copy.apiKeyHeader;
        if (copy.headers && Object.keys(copy.headers).length === 0) delete copy.headers;
        return copy;
      })
      .filter((m) => m.id);
  }, []);

  const refresh = useCallback(async () => {
    setErr(null);
    setHint(null);
    const [cfg, e] = await Promise.all([
      apiGet<ConfigResponse>("/admin/config"),
      apiGet<EnvResponse>("/admin/env").catch(() => null),
    ]);
    const merged = mergeServerWithDrafts(modelsRef.current, cfg.config.models ?? []);
    setModels(merged);
    setBaseline(fingerprintModels(merged));
    setSelectedKey((prev) => pickSelectionKey(merged, prev));
    setMeta({
      loadedFromPath: cfg.loadedFromPath,
      writeTarget: cfg.writeTarget,
      usedAlternateWritePath: cfg.usedAlternateWritePath,
      configGeneration: cfg.configGeneration,
      configSource: cfg.configSource,
    });
    if (e) setEnv(e);
  }, []);

  useEffect(() => {
    const p = loadPersistedTestStatus();
    if (Object.keys(p).length) setStatusById(p);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const fullConfigInitDone = useRef(false);
  useEffect(() => {
    if (loading || fullConfigInitDone.current || models.length === 0) return;
    fullConfigInitDone.current = true;
    const fileModels = models
      .filter((m) => (m.id ?? "").trim())
      .map((m) => modelToFileJson(m));
    setFullConfigText(`${JSON.stringify({ models: fileModels }, null, 2)}\n`);
  }, [loading, models]);

  const updateSelected = useCallback(
    (patch: Partial<ModelConfig>) => {
      setModels((prev) => {
        const idx = prev.findIndex((m) => (m._uiKey ?? m.id) === selectedKey);
        if (idx < 0) return prev;
        const next = prev.slice();
        next[idx] = { ...prev[idx]!, ...patch };
        return next;
      });
    },
    [selectedKey],
  );

  const addModel = useCallback(() => {
    const draft = mkNewModel();
    const tmpKey = `__new__${Date.now()}`;
    draft._uiKey = tmpKey;
    setModels((prev) => [draft, ...prev]);
    setSelectedKey(tmpKey);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    const label = selected.id.trim() || "(draft)";
    if (!confirm(`Delete model '${label}'?`)) return;
    const sk = selected._uiKey ?? selected.id;
    setModels((prev) => prev.filter((m) => (m._uiKey ?? m.id) !== sk));
    setSelectedKey("");
    setStatusById((p) => {
      const n = { ...p };
      delete n[sk];
      return n;
    });
  }, [selected]);

  const save = useCallback(async () => {
    setErr(null);
    setHint(null);
    const normalized = normalizeBeforeSave(models);
    const dd = dedupeModels(normalized);
    if (!dd.ok) {
      setErr(dd.message);
      return;
    }
    if (normalized.some((m) => !m.id || !m.baseUrl || !m.model)) {
      setErr("Please fill id, baseUrl, model for all models before saving.");
      return;
    }

    for (const m of normalized) {
      if (typeof m.apiKey === "string" && m.apiKey.trim() && !isEnvRef(m.apiKey)) {
        setErr(
          `Model '${m.id}': apiKey must be an env reference like \${ENV_VAR}. Add the secret under Manage env, or click “Create env key” in From env.`,
        );
        return;
      }
    }

    try {
      setSaving(true);
      const res = await apiPut<PutConfigResponse>("/admin/config", { models: normalized });
      if (res.hint) setHint(res.hint);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }, [models, normalizeBeforeSave, refresh]);

  const reloadFromDisk = useCallback(async () => {
    if (reloadInFlight.current) return;
    reloadInFlight.current = true;
    setErr(null);
    setHint(null);
    setReloadCooldown(true);
    try {
      await apiPost("/admin/reload");
      await refresh();
      setHint("Reload env: configuration re-read from disk successfully.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setTimeout(() => {
        reloadInFlight.current = false;
        setReloadCooldown(false);
      }, RELOAD_COOLDOWN_MS);
    }
  }, [refresh]);

  const runTestOne = useCallback(
    async (m: ModelConfig, opts?: { silent?: boolean }) => {
      const rowKey = m._uiKey ?? m.id;
      const id = (m.id ?? "").trim();
      const canProbe = id
        ? true
        : Boolean((m.baseUrl ?? "").trim() && (m.model ?? "").trim() && (m.adapter === "ollama" || m.adapter === "openai_compatible" || m.adapter === "deepseek"));

      if (!canProbe) {
        const msg = id ? "Missing fields" : "Set baseUrl, model, adapter before testing";
        const st: RowStatus = { loading: false, ok: false, message: msg, shortErr: shortErr(msg) };
        setStatusById((p) => {
          const next = { ...p, [rowKey]: st };
          persistTestStatus(next);
          return next;
        });
        return st;
      }

      if (!opts?.silent) setRowTesting(rowKey);
      setStatusById((p) => ({
        ...p,
        [rowKey]: { loading: true, message: "Testing…" },
      }));

      try {
        const body = id
          ? { modelId: id }
          : {
            adapter: m.adapter,
            baseUrl: m.baseUrl.trim(),
            model: m.model.trim(),
            timeoutMs: m.timeoutMs,
          };
        const r = await apiPost<TestResp>("/admin/test-connection", body);
        const msg = r.status ? `${r.message} (HTTP ${r.status})` : r.message;
        const st: RowStatus = {
          loading: false,
          ok: r.ok,
          message: msg,
          shortErr: r.ok ? undefined : shortErr(msg),
        };
        setStatusById((p) => {
          const next = { ...p, [rowKey]: st };
          persistTestStatus(next);
          return next;
        });
        return st;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        const st: RowStatus = { loading: false, ok: false, message: msg, shortErr: shortErr(msg) };
        setStatusById((p) => {
          const next = { ...p, [rowKey]: st };
          persistTestStatus(next);
          return next;
        });
        return st;
      } finally {
        if (!opts?.silent) setRowTesting(null);
      }
    },
    [],
  );

  const runTestAllSequential = useCallback(async () => {
    if (testAllInFlight.current) return;
    testAllInFlight.current = true;
    setTestAllRunning(true);
    try {
      const list = modelsRef.current.slice();
      for (const m of list) {
        await runTestOne(m, { silent: true });
      }
    } finally {
      testAllInFlight.current = false;
      setTestAllRunning(false);
    }
  }, [runTestOne]);

  const onTestAllClick = useCallback(() => {
    if (testAllCooldownRef.current || testAllRunning) return;
    void runTestAllSequential().then(() => {
      testAllCooldownRef.current = true;
      setTestAllCooldown(true);
      window.setTimeout(() => {
        testAllCooldownRef.current = false;
        setTestAllCooldown(false);
      }, TEST_ALL_COOLDOWN_MS);
    });
  }, [runTestAllSequential, testAllRunning]);

  useEffect(() => {
    if (loading || !meta) return;
    if (lastAutoTestGeneration.current === meta.configGeneration) return;
    lastAutoTestGeneration.current = meta.configGeneration;
    void runTestAllSequential();
  }, [loading, meta?.configGeneration, runTestAllSequential]);

  useEffect(() => {
    const id = window.setInterval(() => void runTestAllSequential(), AUTO_TEST_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [runTestAllSequential]);

  /** Env var names declared in the dotenv file only (dropdown + env table). */
  const envKeysFromFile = useMemo(() => (env?.keysInDotenvFile ?? []).slice().sort(), [env]);
  const keysInFile = useMemo(() => new Set(envKeysFromFile), [envKeysFromFile]);

  /** Config references ${VAR} but VAR is not listed in .env file — still show in dropdown. */
  const orphanEnvRefName = useMemo(() => {
    if (!selected?.apiKey || !isEnvRef(selected.apiKey)) return null;
    const name = envNameFromRef(selected.apiKey);
    return keysInFile.has(name) ? null : name;
  }, [selected?.apiKey, keysInFile]);

  /** “Create env key” only when model has no apiKey and suggested var is missing from .env. */
  const showCreateEnvKeyButton = useMemo(() => {
    if (!selected) return false;
    if (String(selected.apiKey ?? "").trim()) return false;
    const suggested = suggestApiKeyEnvName(selected.id, selected.adapter);
    return !keysInFile.has(suggested);
  }, [selected, keysInFile]);

  const setApiKeyNone = useCallback(() => updateSelected({ apiKey: undefined }), [updateSelected]);
  const setApiKeyEnv = useCallback((k: string) => updateSelected({ apiKey: k ? `\${${k}}` : undefined }), [updateSelected]);

  const saveEnv = useCallback(async () => {
    const k = envKey.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(k)) {
      setErr("Env key must match A-Z0-9_");
      return;
    }
    setEnvBusy(true);
    setErr(null);
    try {
      const res = await apiPut<PutEnvResponse>("/admin/env", {
        updates: [{ key: k, value: envVal }],
      });
      setHint(`Updated env at ${res.writtenTo}. Keys: ${res.changedKeys.join(", ") || "(none)"}`);
      const fresh = await apiGet<EnvResponse>("/admin/env");
      setEnv(fresh);
      setEnvKey(k);
      setEnvEditRows((fresh.dotenvEntries ?? []).map((e) => ({ key: e.key, value: e.value })));
      await apiPost("/admin/reload");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setEnvBusy(false);
    }
  }, [envKey, envVal, refresh]);

  const openEnvDrawer = useCallback(async () => {
    setErr(null);
    try {
      const fresh = await apiGet<EnvResponse>("/admin/env");
      setEnv(fresh);
      setEnvEditRows((fresh.dotenvEntries ?? []).map((e) => ({ key: e.key, value: e.value })));
      setEnvOpen(true);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }, []);

  const openEnvDrawerWithSuggestedApiKey = useCallback(async () => {
    if (!selected) return;
    const suggested = suggestApiKeyEnvName(selected.id, selected.adapter);
    setEnvKey(suggested);
    setEnvVal("");
    updateSelected({ apiKey: `\${${suggested}}` });
    setApiKeyMode("env");
    await openEnvDrawer();
  }, [selected, openEnvDrawer, updateSelected]);

  const copyDotenvPath = useCallback(async () => {
    const p = env?.dotenvPath ?? "";
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      setHint("Path copied to clipboard.");
    } catch {
      setErr("Could not copy path (clipboard permission).");
    }
  }, [env?.dotenvPath]);

  const saveOneEnvRow = useCallback(
    async (key: string, value: string) => {
      const k = key.trim().toUpperCase();
      if (!/^[A-Z0-9_]+$/.test(k)) {
        setErr("Env key must match A-Z0-9_");
        return;
      }
      setEnvBusy(true);
      setErr(null);
      try {
        const res = await apiPut<PutEnvResponse>("/admin/env", {
          updates: [{ key: k, value }],
        });
        setHint(`Updated env at ${res.writtenTo}. Keys: ${res.changedKeys.join(", ") || k}`);
        const fresh = await apiGet<EnvResponse>("/admin/env");
        setEnv(fresh);
        setEnvEditRows((fresh.dotenvEntries ?? []).map((e) => ({ key: e.key, value: e.value })));
        await apiPost("/admin/reload");
        await refresh();
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setEnvBusy(false);
      }
    },
    [refresh],
  );

  const deleteOneEnvRow = useCallback(
    async (key: string) => {
      const k = key.trim().toUpperCase();
      if (!/^[A-Z0-9_]+$/.test(k)) {
        setErr("Env key must match A-Z0-9_");
        return;
      }
      if (!confirm(`Delete env key '${k}'? This removes it from the .env file.`)) return;
      setEnvBusy(true);
      setErr(null);
      try {
        const res = await apiPut<PutEnvResponse>("/admin/env", {
          updates: [{ key: k, value: null }],
        });
        setHint(`Updated env at ${res.writtenTo}. Keys: ${res.changedKeys.join(", ") || k}`);
        const fresh = await apiGet<EnvResponse>("/admin/env");
        setEnv(fresh);
        setEnvEditRows((fresh.dotenvEntries ?? []).map((e) => ({ key: e.key, value: e.value })));
        setEnvRowOpenKey((prev) => (prev === k ? null : prev));
        await apiPost("/admin/reload");
        await refresh();
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setEnvBusy(false);
      }
    },
    [refresh],
  );

  const duplicateEnvRow = useCallback(
    (rowKey: string) => {
      const used = new Set(envEditRows.map((r) => r.key));
      const row = envEditRows.find((r) => r.key === rowKey);
      if (!row) return;
      const nk = nextCopyEnvKey(rowKey, used);
      setEnvEditRows((prev) => [...prev, { key: nk, value: row.value }]);
      setEnvRowOpenKey(nk);
    },
    [envEditRows],
  );

  const serializeModelsFileJson = useCallback(() => {
    const fileModels = models
      .filter((m) => (m.id ?? "").trim())
      .map((m) => modelToFileJson(m));
    return `${JSON.stringify({ models: fileModels }, null, 2)}\n`;
  }, [models]);

  const applyFullConfigText = useCallback(() => {
    setErr(null);
    try {
      const parsed = JSON.parse(fullConfigText) as { models?: ModelConfig[] };
      if (!parsed || !Array.isArray(parsed.models)) {
        setErr("JSON must be an object with a models array.");
        return;
      }
      const next: ModelConfig[] = parsed.models.map((m, i) => {
        const id = String(m.id ?? "").trim();
        const ui: ModelConfig = {
          ...m,
          id,
          adapter: m.adapter,
          baseUrl: String(m.baseUrl ?? ""),
          model: String(m.model ?? ""),
          _uiKey: id ? id : `__new__${Date.now()}_${i}`,
        };
        return ui;
      });
      const normalized = normalizeBeforeSave(next);
      if (normalized.length === 0) {
        setErr("At least one model with a non-empty id is required.");
        return;
      }
      const dd = dedupeModels(normalized);
      if (!dd.ok) {
        setErr(dd.message);
        return;
      }
      setModels(next);
      setHint("Config loaded from editor — click Save to persist to models.json.");
    } catch (e: any) {
      setErr(e?.message ?? "Invalid JSON");
    }
  }, [fullConfigText, normalizeBeforeSave]);

  const rawJsonText = useMemo(() => {
    if (!selected) return "";
    return `${JSON.stringify(modelToFileJson(selected), null, 2)}\n`;
  }, [selected]);

  const dotenvPathDisplay = env?.dotenvPath ?? "";

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="topbarTitle">Configuration</div>
          {meta && (
            <div className="muted" style={{ fontSize: "0.82rem" }}>
              Config: <span className="mono">{meta.writeTarget}</span>
            </div>
          )}
        </div>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => void openEnvDrawer()} disabled={loading}>
          Manage env
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void onTestAllClick()}
          disabled={testAllRunning || testAllCooldown || loading}
          title="Test all models sequentially"
        >
          {testAllRunning ? "Testing all…" : "Test all"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void reloadFromDisk()}
          disabled={saving || reloadCooldown}
          title="Reload models.json from disk. Environment variables are re-read so ${ENV} references in config resolve again."
        >
          {reloadCooldown ? "Reload env…" : "Reload env"}
        </button>
        <button type="button" className="btn btnPrimary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {err && <div className="alert err">{err}</div>}
      {hint && <div className="alert">{hint}</div>}
      {dirty && (
        <div className="alert okHint">Changes pending — click <strong>Save</strong> to write models.json.</div>
      )}
      {loading && <div className="muted">Loading…</div>}

      <div className="split">
        <div className="panel">
          <div className="panelHeader">
            <div className="panelTitle">Models</div>
            <div className="spacer" />
            <button type="button" className="btn mini" onClick={addModel}>
              + Add model
            </button>
          </div>

          <div className="tableWrap">
            <table className="table tableCompact">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Adapter</th>
                  <th>Base URL</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th className="tableCellErr" title="Last test error (short)">
                    Err
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const rowKey = m._uiKey ?? m.id;
                  const st = statusById[rowKey];
                  const loadingRow = Boolean(st?.loading);
                  return (
                    <tr
                      key={rowKey}
                      className={`clickable ${rowKey === selectedKey ? "selectedRow" : ""}`}
                      onClick={() => setSelectedKey(rowKey)}
                    >
                      <td className="mono tableCellClip" title={m.id || ""}>
                        {m.id || "—"}
                      </td>
                      <td className="tableCellClip" title={m.adapter}>
                        {m.adapter}
                      </td>
                      <td className="mono tableCellClip" title={m.baseUrl}>
                        {m.baseUrl}
                      </td>
                      <td className="mono tableCellClip" title={m.model}>
                        {m.model}
                      </td>
                      <td className={st && !st.loading && st.ok === true ? "good" : st && !st.loading && st.ok === false ? "bad" : "muted"}>
                        {loadingRow ? "…" : st && st.ok === true ? "OK" : st && st.ok === false ? "Err" : "—"}
                      </td>
                      <td className="muted tableCellClip tableCellErr" title={st?.message}>
                        {loadingRow ? "…" : st?.shortErr ?? "—"}
                      </td>
                    </tr>
                  );
                })}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No models
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <div className="panelTitle">Edit model</div>
            <div className="panelHint">{selected ? selected.id || "(draft)" : "Select a model"}</div>
            <div className="spacer" />
            <button type="button" className="btn btnDanger mini" onClick={deleteSelected} disabled={!selected}>
              Delete
            </button>
          </div>

          {!selected ? (
            <div className="muted">Select a model to edit</div>
          ) : (
            <div className="formGrid formStack">
              <label className="field">
                <span className="fieldLabel">ID</span>
                <input
                  value={selected.id}
                  onChange={(e) => updateSelected({ id: e.target.value })}
                  placeholder="e.g. ollama-local"
                />
              </label>

              <label className="field">
                <span className="fieldLabel">Adapter</span>
                <select value={selected.adapter} onChange={(e) => updateSelected({ adapter: e.target.value as Adapter })}>
                  <option value="ollama">ollama</option>
                  <option value="openai_compatible">openai_compatible</option>
                  <option value="deepseek">deepseek</option>
                </select>
              </label>

              <label className="field">
                <span className="fieldLabel">Base URL</span>
                <input
                  value={selected.baseUrl}
                  onChange={(e) => updateSelected({ baseUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                />
              </label>

              <label className="field">
                <span className="fieldLabel">Model</span>
                <input
                  value={selected.model}
                  onChange={(e) => updateSelected({ model: e.target.value })}
                  placeholder="llama3 / gpt-4o-mini / ..."
                />
              </label>

              <div className="field">
                <span className="fieldLabel">API key</span>
                <div className="apiKeyModeRow">
                  <button
                    type="button"
                    className={`btn mini${apiKeyMode === "none" ? " modeOn" : ""}`}
                    onClick={() => {
                      setApiKeyMode("none");
                      setApiKeyNone();
                    }}
                  >
                    None
                  </button>
                  <button
                    type="button"
                    className={`btn mini${apiKeyMode === "env" ? " modeOn" : ""}`}
                    onClick={() => {
                      setApiKeyMode("env");
                      if (!selected.apiKey || !isEnvRef(selected.apiKey)) {
                        setApiKeyEnv(envKeysFromFile[0] ?? "");
                      }
                    }}
                  >
                    From env
                  </button>
                </div>

                {apiKeyMode === "env" && (
                  <>
                    <label className="field" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                      <span className="fieldLabel">Variable (from .env file)</span>
                      <select
                        value={selected.apiKey && isEnvRef(selected.apiKey) ? envNameFromRef(selected.apiKey) : ""}
                        onChange={(e) => setApiKeyEnv(e.target.value)}
                      >
                        <option value="">(select)</option>
                        {orphanEnvRefName && (
                          <option value={orphanEnvRefName}>
                            {orphanEnvRefName} (not in .env — add under Manage env)
                          </option>
                        )}
                        {envKeysFromFile.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                    {showCreateEnvKeyButton && (
                      <div style={{ marginTop: "0.35rem" }}>
                        <button type="button" className="btn mini ghost" onClick={() => void openEnvDrawerWithSuggestedApiKey()}>
                          Create env key · <span className="mono">{suggestApiKeyEnvName(selected.id, selected.adapter)}</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <details className="panel" style={{ marginTop: "0.6rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 650 }}>Edit Raw JSON</summary>
                <textarea className="raw" readOnly value={rawJsonText} style={{ marginTop: "0.75rem" }} />
              </details>
            </div>
          )}
        </div>
      </div>

      <details className="panel" style={{ marginTop: "0.5rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 650 }}>Edit full models.json</summary>
        <div className="stack" style={{ marginTop: "0.75rem" }}>
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", marginBottom: 0 }}>
            <button type="button" className="btn mini" onClick={() => setFullConfigText(serializeModelsFileJson())}>
              Load from table
            </button>
            <button type="button" className="btn mini" onClick={() => void applyFullConfigText()}>
              Apply to table
            </button>
          </div>
          <textarea
            className="raw"
            value={fullConfigText}
            onChange={(e) => setFullConfigText(e.target.value)}
            spellCheck={false}
          />
        </div>
      </details>

      <Drawer open={envOpen} title="Manage env" showCloseButton={false} onClose={() => setEnvOpen(false)}>
        {!env ? (
          <div className="muted">Env API unavailable</div>
        ) : (
          <div className="stack">
            <div className="row" style={{ alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: 0 }}>
              <div className="muted" style={{ fontSize: "0.82rem" }}>
                {env.dotenvSource} · path in clipboard via button
              </div>
              <button type="button" className="btn mini" onClick={() => void copyDotenvPath()} title={dotenvPathDisplay}>
                Copy path
              </button>
            </div>

            <div className="panelSub">
              <div className="panelHeader">
                <div className="panelTitle">Add / update key</div>
              </div>
              <div className="stack" style={{ maxWidth: "44rem" }}>
                <label className="field">
                  <span className="fieldLabel">Key</span>
                  <input
                    className="mono"
                    style={{ width: "100%" }}
                    value={envKey}
                    onChange={(e) => setEnvKey(e.target.value)}
                    placeholder="OPENAI_API_KEY"
                  />
                </label>
                <label className="field">
                  <span className="fieldLabel">Value</span>
                  <textarea
                    rows={3}
                    style={{ width: "100%" }}
                    value={envVal}
                    onChange={(e) => setEnvVal(e.target.value)}
                    placeholder="paste token"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button type="button" className="btn" onClick={() => void saveEnv()} disabled={envBusy}>
                  {envBusy ? "Saving…" : "Save env"}
                </button>
                <div className="muted" style={{ fontSize: "0.82rem" }}>
                  After saving, the server updates runtime env and reloads config automatically.
                </div>
              </div>
            </div>

            <div className="panelSub">
              <div className="panelHeader">
                <div className="panelTitle">Variables in .env file</div>
                <div className="panelHint">Click a key to view/edit. Save only appears when the value changed.</div>
              </div>
              <div className="stack" style={{ gap: "0.5rem" }}>
                {envEditRows.map((row) => {
                  const open = envRowOpenKey === row.key;
                  const original = (env?.dotenvEntries ?? []).find((e) => e.key === row.key)?.value ?? "";
                  const dirty = row.value !== original;
                  return (
                    <div key={row.key} className="panelSub" style={{ padding: "0.6rem", borderRadius: 10 }}>
                      <button
                        type="button"
                        className="btn mini ghost"
                        style={{ width: "100%", textAlign: "left" }}
                        onClick={() => setEnvRowOpenKey((prev) => (prev === row.key ? null : row.key))}
                      >
                        <span className="mono">{row.key}</span>
                        {dirty && <span className="muted"> · modified</span>}
                      </button>
                      {open && (
                        <div className="stack" style={{ marginTop: "0.5rem" }}>
                          <textarea
                            className="mono"
                            style={{ width: "100%", minHeight: "4.25rem", fontSize: "0.82rem" }}
                            value={row.value}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEnvEditRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, value: v } : r)));
                            }}
                            spellCheck={false}
                          />
                          <div className="row" style={{ gap: "0.5rem", marginBottom: 0 }}>
                            {dirty && (
                              <button
                                type="button"
                                className="btn mini btnPrimary"
                                disabled={envBusy}
                                onClick={() => void saveOneEnvRow(row.key, row.value)}
                              >
                                Save
                              </button>
                            )}
                            <button type="button" className="btn mini" onClick={() => duplicateEnvRow(row.key)} disabled={envBusy}>
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="btn mini btnDanger"
                              onClick={() => void deleteOneEnvRow(row.key)}
                              disabled={envBusy}
                              title="Deletes this key from the .env file"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {envEditRows.length === 0 && (
                  <div className="muted">No keys in .env (file missing or empty). Add a key above.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
