import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pencil, CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { setHash } from "../lib/hashRoute";

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

type DiscoverResp = { ok: boolean; models: string[]; message?: string; status?: number };

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

function mkNewModel(usedIds: Set<string>): ModelConfig {
  let n = Date.now();
  let id = `model-${n}`;
  while (usedIds.has(id)) {
    n += 1;
    id = `model-${n}`;
  }
  return {
    id,
    adapter: "openai_compatible",
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
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
  const [envSheetOpen, setEnvSheetOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
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

  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);
  const [discoverApiKey, setDiscoverApiKey] = useState("");
  const discoverBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const selectedRowKey = selected ? (selected._uiKey ?? selected.id) : "";

  useEffect(() => {
    setDiscoveredModels([]);
    setDiscoverErr(null);
    setDiscoverLoading(false);
  }, [selectedKey]);

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
    const tmpKey = `__new__${Date.now()}`;
    setModels((prev) => {
      const used = new Set(prev.map((m) => (m.id ?? "").trim()).filter(Boolean));
      const draft = mkNewModel(used);
      draft._uiKey = tmpKey;
      return [draft, ...prev];
    });
    setSelectedKey(tmpKey);
    setModelSheetOpen(true);
  }, []);

  const runDiscover = useCallback(async () => {
    if (!selected) return;
    const baseUrl = (selected.baseUrl ?? "").trim();
    if (!baseUrl) {
      setDiscoverErr("Set a base URL first");
      return;
    }
    setDiscoverErr(null);
    setDiscoverLoading(true);
    try {
      const r = await apiPost<DiscoverResp>("/admin/discover-upstream-models", {
        adapter: selected.adapter,
        baseUrl,
        apiKey: discoverApiKey.trim() || undefined,
      });
      if (!r.ok) {
        setDiscoveredModels([]);
        setDiscoverErr(r.message ?? "Could not list models");
        return;
      }
      setDiscoveredModels(r.models ?? []);
      if ((r.models?.length ?? 0) > 0 && !(selected.model ?? "").trim()) {
        updateSelected({ model: r.models![0]! });
      }
    } catch (e: unknown) {
      setDiscoveredModels([]);
      setDiscoverErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscoverLoading(false);
    }
  }, [selected, discoverApiKey, updateSelected]);

  const scheduleDiscoverFromBlur = useCallback(() => {
    if (discoverBlurTimer.current) clearTimeout(discoverBlurTimer.current);
    discoverBlurTimer.current = setTimeout(() => {
      discoverBlurTimer.current = null;
      void runDiscover();
    }, 550);
  }, [runDiscover]);

  useEffect(
    () => () => {
      if (discoverBlurTimer.current) clearTimeout(discoverBlurTimer.current);
    },
    [],
  );

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    const label = selected.id.trim() || "(draft)";
    if (!confirm(`Delete model '${label}'?`)) return;
    const sk = selected._uiKey ?? selected.id;
    setModels((prev) => prev.filter((m) => (m._uiKey ?? m.id) !== sk));
    setSelectedKey("");
    setModelSheetOpen(false);
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
      setEnvSheetOpen(true);
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

  const playgroundStatus = selected ? statusById[selectedRowKey] : undefined;
  const canOpenPlayground =
    Boolean(selected?.id?.trim()) &&
    playgroundStatus?.ok === true &&
    !playgroundStatus?.loading &&
    rowTesting !== selectedRowKey;

  const selectFieldClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Configuration</h1>
          {meta ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Config: <span className="font-mono text-foreground/90">{meta.writeTarget}</span>
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void openEnvDrawer()} disabled={loading}>
          Manage env
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onTestAllClick()}
          disabled={testAllRunning || testAllCooldown || loading}
          title="Test all models sequentially"
        >
          {testAllRunning ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Testing all…
            </>
          ) : (
            "Test all"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void reloadFromDisk()}
          disabled={saving || reloadCooldown}
          title="Reload models.json from disk. Environment variables are re-read so ${ENV} references in config resolve again."
        >
          {reloadCooldown ? "Reload env…" : "Reload env"}
        </Button>
        <Button
          type="button"
          variant={canOpenPlayground ? "default" : "secondary"}
          size="sm"
          disabled={!canOpenPlayground}
          title={
            canOpenPlayground
              ? "Open Playground with this model selected"
              : "Save config and wait for connection test OK to enable"
          }
          onClick={() => {
            if (!selected?.id.trim()) return;
            setHash(`playground?model=${encodeURIComponent(selected.id.trim())}`);
          }}
        >
          Playground
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {err ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>
      ) : null}
      {hint ? <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">{hint}</div> : null}
      {dirty ? (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Changes pending — click <strong>Save</strong> to write models.json.
        </div>
      ) : null}
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      <div className="rounded-xl border border-border bg-card shadow">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Models</h2>
          <div className="flex-1" />
          <Button
            type="button"
            size="sm"
            className="bg-gradient-to-r from-violet-600 to-sky-500 font-medium text-white shadow hover:from-violet-500 hover:to-sky-400 hover:shadow-[0_0_20px_rgba(56,189,248,0.35)]"
            onClick={addModel}
          >
            + Add model
          </Button>
        </div>

        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-medium">ID</th>
                <th className="px-2 py-2 font-medium">Adapter</th>
                <th className="px-2 py-2 font-medium">Base URL</th>
                <th className="px-2 py-2 font-medium">Model</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium" title="Last test error (short)">
                  Err
                </th>
                <th className="px-2 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const rowKey = m._uiKey ?? m.id;
                const st = statusById[rowKey];
                const loadingRow = Boolean(st?.loading);
                const ok = st && !st.loading && st.ok === true;
                const bad = st && !st.loading && st.ok === false;
                return (
                  <tr
                    key={rowKey}
                    className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-white/[0.03] ${
                      rowKey === selectedKey ? "bg-primary/10" : ""
                    }`}
                    onClick={() => setSelectedKey(rowKey)}
                  >
                    <td className="max-w-[10rem] truncate px-2 py-2 font-mono text-xs" title={m.id || ""}>
                      {m.id || "—"}
                    </td>
                    <td className="max-w-[8rem] truncate px-2 py-2 text-xs" title={m.adapter}>
                      {m.adapter}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-2 font-mono text-xs" title={m.baseUrl}>
                      {m.baseUrl}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-2 font-mono text-xs" title={m.model}>
                      {m.model}
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        {loadingRow ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Testing" />
                            <span className="text-muted-foreground">…</span>
                          </>
                        ) : ok ? (
                          <>
                            <CircleCheck className="size-3.5 text-emerald-400" aria-hidden />
                            <span className="text-emerald-400">OK</span>
                          </>
                        ) : bad ? (
                          <>
                            <CircleX className="size-3.5 text-red-400" aria-hidden />
                            <span className="text-red-400">Err</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                    </td>
                    <td className="max-w-[8rem] truncate px-2 py-2 text-xs text-muted-foreground" title={st?.message}>
                      {loadingRow ? "…" : st?.shortErr ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit model"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedKey(rowKey);
                          setModelSheetOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {models.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No models
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={modelSheetOpen} onOpenChange={setModelSheetOpen}>
        <SheetContent className="sm:max-w-xl" showClose>
          <SheetHeader>
            <SheetTitle>Edit model</SheetTitle>
            <SheetDescription>{selected ? selected.id || "(draft)" : "Select a model from the table"}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-wrap gap-2 border-b border-border pb-4">
            <Button type="button" variant="destructive" size="sm" onClick={deleteSelected} disabled={!selected}>
              Delete
            </Button>
          </div>
          {!selected ? (
            <p className="mt-4 text-sm text-muted-foreground">Select a model in the table, then use Edit.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-6">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Basic info</p>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cfg-model-id">ID</Label>
                    <Input
                      id="cfg-model-id"
                      value={selected.id}
                      onChange={(e) => updateSelected({ id: e.target.value })}
                      placeholder="e.g. ollama-local"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cfg-adapter">Adapter</Label>
                    <select
                      id="cfg-adapter"
                      className={selectFieldClass}
                      value={selected.adapter}
                      onChange={(e) => updateSelected({ adapter: e.target.value as Adapter })}
                    >
                      <option value="ollama">ollama</option>
                      <option value="openai_compatible">openai_compatible</option>
                      <option value="deepseek">deepseek</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cfg-base-url">Base URL</Label>
                    <div className="flex flex-wrap items-stretch gap-2">
                      <Input
                        id="cfg-base-url"
                        className="min-w-[8rem] flex-1"
                        value={selected.baseUrl}
                        onChange={(e) => updateSelected({ baseUrl: e.target.value })}
                        onBlur={() => scheduleDiscoverFromBlur()}
                        placeholder="http://localhost:11434"
                      />
                      <Button type="button" variant="secondary" size="sm" disabled={discoverLoading} onClick={() => void runDiscover()}>
                        {discoverLoading ? (
                          <>
                            <Loader2 className="animate-spin" aria-hidden />
                            Fetching…
                          </>
                        ) : (
                          "Fetch models"
                        )}
                      </Button>
                    </div>
                    {discoverErr ? (
                      <div className="mt-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                        {discoverErr}
                      </div>
                    ) : null}
                  </div>

                  {(selected.adapter === "openai_compatible" || selected.adapter === "deepseek") && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="cfg-discover-key">Discovery API key (optional, not saved)</Label>
                      <Input
                        id="cfg-discover-key"
                        type="password"
                        autoComplete="off"
                        value={discoverApiKey}
                        onChange={(e) => setDiscoverApiKey(e.target.value)}
                        placeholder="Bearer token for listing /v1/models only"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cfg-model-name">Model</Label>
                    {discoveredModels.length > 0 ? (
                      <select
                        id="cfg-model-pick"
                        className={selectFieldClass}
                        value={discoveredModels.includes(selected.model) ? selected.model : "__custom__"}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__custom__") return;
                          updateSelected({ model: v });
                        }}
                      >
                        {discoveredModels.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                        <option value="__custom__">Custom…</option>
                      </select>
                    ) : null}
                    <Input
                      id="cfg-model-name"
                      className={discoveredModels.length > 0 ? "mt-1" : ""}
                      value={selected.model}
                      onChange={(e) => updateSelected({ model: e.target.value })}
                      placeholder="llama3 / gpt-4o-mini / …"
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auth / API keys</p>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={apiKeyMode === "none" ? "default" : "outline"}
                      onClick={() => {
                        setApiKeyMode("none");
                        setApiKeyNone();
                      }}
                    >
                      None
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={apiKeyMode === "env" ? "default" : "outline"}
                      onClick={() => {
                        setApiKeyMode("env");
                        if (!selected.apiKey || !isEnvRef(selected.apiKey)) {
                          setApiKeyEnv(envKeysFromFile[0] ?? "");
                        }
                      }}
                    >
                      From env
                    </Button>
                  </div>

                  {apiKeyMode === "env" && (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="cfg-env-var">Variable (from .env file)</Label>
                        <select
                          id="cfg-env-var"
                          className={selectFieldClass}
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
                      </div>
                      {showCreateEnvKeyButton && (
                        <Button type="button" variant="ghost" size="sm" className="h-auto justify-start px-0" onClick={() => void openEnvDrawerWithSuggestedApiKey()}>
                          Create env key ·{" "}
                          <span className="font-mono text-xs">{suggestApiKeyEnvName(selected.id, selected.adapter)}</span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <details className="rounded-lg border border-border bg-muted/10 px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">Edit Raw JSON</summary>
                <textarea
                  readOnly
                  value={rawJsonText}
                  className="mt-3 min-h-[180px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </details>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <details className="mt-2 rounded-xl border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">Edit full models.json</summary>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setFullConfigText(serializeModelsFileJson())}>
              Load from table
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => void applyFullConfigText()}>
              Apply to table
            </Button>
          </div>
          <textarea
            value={fullConfigText}
            onChange={(e) => setFullConfigText(e.target.value)}
            spellCheck={false}
            className="min-h-[220px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </details>

      <Sheet open={envSheetOpen} onOpenChange={setEnvSheetOpen}>
        <SheetContent className="sm:max-w-lg" showClose>
          <SheetHeader>
            <SheetTitle>Manage env</SheetTitle>
            <SheetDescription>View and edit variables stored in the server .env file.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-6">
            {!env ? (
              <p className="text-sm text-muted-foreground">Env API unavailable</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">{env.dotenvSource} · path in clipboard via button</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copyDotenvPath()} title={dotenvPathDisplay}>
                    Copy path
                  </Button>
                </div>

                <div className="rounded-lg border border-border/80 bg-muted/10 p-3">
                  <h3 className="text-sm font-semibold">Add / update key</h3>
                  <div className="mt-3 flex max-w-xl flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="env-new-key">Key</Label>
                      <Input id="env-new-key" className="font-mono text-sm" value={envKey} onChange={(e) => setEnvKey(e.target.value)} placeholder="OPENAI_API_KEY" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="env-new-val">Value</Label>
                      <textarea
                        id="env-new-val"
                        rows={3}
                        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={envVal}
                        onChange={(e) => setEnvVal(e.target.value)}
                        placeholder="paste token"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <Button type="button" onClick={() => void saveEnv()} disabled={envBusy}>
                      {envBusy ? "Saving…" : "Save env"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      After saving, the server updates runtime env and reloads config automatically.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border/80 bg-muted/10 p-3">
                  <h3 className="text-sm font-semibold">Variables in .env file</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Click a key to view/edit. Save only appears when the value changed.</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {envEditRows.map((row) => {
                      const open = envRowOpenKey === row.key;
                      const original = (env?.dotenvEntries ?? []).find((e) => e.key === row.key)?.value ?? "";
                      const dirty = row.value !== original;
                      return (
                        <div key={row.key} className="rounded-lg border border-border/60 bg-background/40 p-2">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                            onClick={() => setEnvRowOpenKey((prev) => (prev === row.key ? null : row.key))}
                          >
                            <span className="font-mono text-xs">{row.key}</span>
                            {dirty ? <span className="text-xs text-muted-foreground">modified</span> : null}
                          </button>
                          {open ? (
                            <div className="mt-2 flex flex-col gap-2">
                              <textarea
                                className="min-h-[4.25rem] w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={row.value}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEnvEditRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, value: v } : r)));
                                }}
                                spellCheck={false}
                              />
                              <div className="flex flex-wrap gap-2">
                                {dirty ? (
                                  <Button type="button" size="sm" disabled={envBusy} onClick={() => void saveOneEnvRow(row.key, row.value)}>
                                    Save
                                  </Button>
                                ) : null}
                                <Button type="button" size="sm" variant="secondary" onClick={() => duplicateEnvRow(row.key)} disabled={envBusy}>
                                  Duplicate
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => void deleteOneEnvRow(row.key)}
                                  disabled={envBusy}
                                  title="Deletes this key from the .env file"
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {envEditRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No keys in .env (file missing or empty). Add a key above.</p>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
