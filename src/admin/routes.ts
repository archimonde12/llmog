import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModelsFile } from "../types";
import type { ResolvedModelsSource } from "../config/load";
import { loadModelsFileFromPath, loadModelsFileFromPathAsStored } from "../config/load";
import {
  parseModelsFileJson,
  resolveWriteTarget,
  writeModelsFileAtomic,
} from "./configStore";
import { isLocalhostRequest, sendForbiddenNonLocal } from "./auth";
import type { Metrics } from "../observability/metrics";
import type { RequestRecorder } from "../observability/requestRecorder";
import { buildMetricsSummary } from "../observability/summary";
import { resolveModelConfig } from "../config";
import { probeModelUpstream } from "../upstreamProbe";
import type { ModelRequestStore } from "../observability/modelRequestStore";
import type { ModelMessageDebugStore, MessageDebugRole } from "../observability/modelMessageDebugStore";
import { applyEnvUpdates, listEnvKeys, listEntriesInDotenvFile, listKeysInDotenvFile, resolveDotenvPath } from "./envStore";

function parseRange(raw: unknown): { ok: true; ms: number; label: "15m" | "1h" | "24h" } | { ok: false } {
  const v = String(raw ?? "").trim();
  if (v === "15m") return { ok: true, ms: 15 * 60_000, label: "15m" };
  if (v === "1h") return { ok: true, ms: 60 * 60_000, label: "1h" };
  if (v === "24h") return { ok: true, ms: 24 * 60 * 60_000, label: "24h" };
  return { ok: false };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export type RuntimeState = {
  modelsFile: ModelsFile;
  /** Canonical path for reload and for resolving write target */
  activeConfigPath: string;
  bootstrapSource: ResolvedModelsSource;
  configGeneration: number;
};

const TestBodySchema = z.union([
  z.object({ modelId: z.string().min(1) }),
  z.object({
    adapter: z.enum(["ollama", "openai_compatible", "deepseek"]),
    baseUrl: z.string().min(1),
    model: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    apiKey: z.string().optional(),
    apiKeyHeader: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);

export async function registerAdminRoutes(
  app: FastifyInstance,
  ctx: {
    state: RuntimeState;
    metrics: Metrics;
    recorder: RequestRecorder;
    modelRequests: ModelRequestStore;
    modelMessages: ModelMessageDebugStore;
    packageVersion: string;
    enforceLocalhost: boolean;
  },
) {
  const guard = async (req: any, reply: any) => {
    if (!ctx.enforceLocalhost) return;
    if (!isLocalhostRequest(req)) return sendForbiddenNonLocal(reply);
  };

  app.get("/admin/env", { preHandler: guard }, async () => {
    const r = resolveDotenvPath(ctx.state.activeConfigPath);
    const [keysInDotenvFile, dotenvEntries] = await Promise.all([
      listKeysInDotenvFile(r.path),
      listEntriesInDotenvFile(r.path),
    ]);
    return {
      keys: listEnvKeys(),
      keysInDotenvFile,
      dotenvEntries,
      dotenvPath: r.path,
      dotenvSource: r.source,
    };
  });

  app.put("/admin/env", { preHandler: guard }, async (req, reply) => {
    const Body = z.object({
      updates: z.array(
        z.object({
          key: z.string().min(1),
          value: z.union([z.string(), z.null()]),
        }),
      ),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: {
          message: "Invalid body",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      };
    }

    const r = resolveDotenvPath(ctx.state.activeConfigPath);
    try {
      const result = await applyEnvUpdates({
        dotenvPath: r.path,
        updates: parsed.data.updates,
      });
      return {
        ok: true,
        writtenTo: result.writtenTo,
        changedKeys: result.changedKeys,
        note: "Runtime process.env was updated; if your config references ${ENV_VAR}, call /admin/reload to re-resolve.",
      };
    } catch (err: any) {
      const statusCode = typeof err?.statusCode === "number" ? err.statusCode : 500;
      reply.code(statusCode);
      return { error: { message: err?.message ?? String(err) } };
    }
  });

  app.get("/admin/health", { preHandler: guard }, async () => ({
    ok: true,
    version: ctx.packageVersion,
    ui: true,
    activeConfigPath: ctx.state.activeConfigPath,
  }));

  app.get("/admin/config", { preHandler: guard }, async () => {
    const wt = await resolveWriteTarget(ctx.state.activeConfigPath);
    let config = ctx.state.modelsFile;
    try {
      config = await loadModelsFileFromPathAsStored(ctx.state.activeConfigPath);
    } catch {
      // Fall back to in-memory config if the file is unreadable (should be rare).
    }
    return {
      config,
      loadedFromPath: ctx.state.activeConfigPath,
      writeTarget: wt.writeTarget,
      usedAlternateWritePath: wt.usedAlternate,
      configSource: ctx.state.bootstrapSource.kind,
      configGeneration: ctx.state.configGeneration,
    };
  });

  app.put("/admin/config", { preHandler: guard }, async (req, reply) => {
    const raw = req.body;
    const parsed = parseModelsFileJson(raw);
    if (!parsed.ok) {
      reply.code(400);
      return { error: { message: "Validation failed", issues: parsed.issues } };
    }

    const wt = await resolveWriteTarget(ctx.state.activeConfigPath);
    try {
      await writeModelsFileAtomic(wt.writeTarget, parsed.data);
    } catch (err: any) {
      reply.code(500);
      return {
        error: {
          message: `Failed to write config: ${err?.message ?? String(err)}`,
        },
      };
    }

    ctx.state.activeConfigPath = wt.writeTarget;
    ctx.state.configGeneration++;
    try {
      ctx.state.modelsFile = await loadModelsFileFromPath(wt.writeTarget);
    } catch {
      ctx.state.modelsFile = parsed.data;
    }

    return {
      ok: true,
      writtenTo: wt.writeTarget,
      usedAlternateWritePath: wt.usedAlternate,
      configGeneration: ctx.state.configGeneration,
      hint: wt.usedAlternate
        ? "Config was written to the managed path because the previous location was not writable. Point MODELS_PATH or --models to this file if you want the CLI to use it."
        : undefined,
    };
  });

  app.post("/admin/reload", { preHandler: guard }, async (_req, reply) => {
    let mf: ModelsFile;
    try {
      mf = await loadModelsFileFromPath(ctx.state.activeConfigPath);
    } catch (err: any) {
      reply.code(500);
      return { error: { message: err?.message ?? String(err) } };
    }
    ctx.state.modelsFile = mf;
    ctx.state.configGeneration++;
    return {
      ok: true,
      activeConfigPath: ctx.state.activeConfigPath,
      configGeneration: ctx.state.configGeneration,
    };
  });

  app.post("/admin/test-connection", { preHandler: guard }, async (req, reply) => {
    const parsed = TestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: {
          message: "Invalid body",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      };
    }

    const body = parsed.data;

    if ("modelId" in body) {
      try {
        const mc = resolveModelConfig(ctx.state.modelsFile, body.modelId);
        const result = await probeModelUpstream(mc);
        return {
          ok: result.ok,
          status: result.status,
          message: result.message,
          baseUrl: mc.baseUrl.replace(/\/+$/, ""),
        };
      } catch (err: any) {
        reply.code(400);
        return { error: { message: err?.message ?? String(err) } };
      }
    }

    const mc = {
      adapter: body.adapter,
      baseUrl: body.baseUrl,
      timeoutMs: body.timeoutMs,
      apiKey: body.apiKey,
      apiKeyHeader: body.apiKeyHeader,
      headers: body.headers,
    };
    const result = await probeModelUpstream(mc);
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      baseUrl: body.baseUrl.replace(/\/+$/, ""),
    };
  });

  app.get("/admin/metrics/summary", { preHandler: guard }, async () => {
    return buildMetricsSummary(ctx.metrics);
  });

  app.get("/admin/metrics/overview", { preHandler: guard }, async (req, reply) => {
    const q = req.query as { range?: string };
    const parsed = parseRange(q.range ?? "15m");
    if (!parsed.ok) {
      reply.code(400);
      return { error: { message: "Invalid range. Use 15m|1h|24h" } };
    }

    const now = Date.now();
    const since = now - parsed.ms;
    const logs = ctx.modelRequests.getRecent(50_000);
    const inRange = logs.filter((r) => r.ts >= since && r.ts <= now);

    const reqCount = inRange.length;
    const errCount = inRange.filter((r) => r.status >= 400).length;
    const errorRate = reqCount > 0 ? errCount / reqCount : 0;

    const lat = inRange.map((r) => r.latencyMs).filter((x) => Number.isFinite(x)) as number[];
    lat.sort((a, b) => a - b);
    const latencyP50 = percentile(lat, 0.5);
    const latencyP95 = percentile(lat, 0.95);

    let tokensInTotal = 0;
    let tokensOutTotal = 0;
    for (const r of inRange) {
      const u = r.usage;
      if (u && typeof u.prompt_tokens === "number") tokensInTotal += u.prompt_tokens;
      if (u && typeof u.completion_tokens === "number") tokensOutTotal += u.completion_tokens;
    }

    const bucketMs = parsed.label === "24h" ? 15 * 60_000 : 60_000;
    const bucketCount = Math.ceil(parsed.ms / bucketMs);
    const buckets = new Array(bucketCount).fill(0).map((_, i) => ({
      ts: since + i * bucketMs,
      tokens_in: 0,
      tokens_out: 0,
      req_count: 0,
      error_count: 0,
    }));

    for (const r of inRange) {
      const bi = Math.floor((r.ts - since) / bucketMs);
      if (bi < 0 || bi >= buckets.length) continue;
      const b = buckets[bi]!;
      b.req_count++;
      if (r.status >= 400) b.error_count++;
      const u = r.usage;
      if (u && typeof u.prompt_tokens === "number") b.tokens_in += u.prompt_tokens;
      if (u && typeof u.completion_tokens === "number") b.tokens_out += u.completion_tokens;
    }

    return {
      req_count: reqCount,
      error_rate: errorRate,
      latency_p50_ms: latencyP50,
      latency_p95_ms: latencyP95,
      tokens_in_total: tokensInTotal,
      tokens_out_total: tokensOutTotal,
      timeseries: buckets,
    };
  });

  app.get("/admin/logs/models", { preHandler: guard }, async (req) => {
    const q = req.query as {
      range?: string;
      modelId?: string;
      status?: string;
      limit?: string;
    };
    const parsed = parseRange(q.range ?? "15m");
    const lim = Math.min(500, Math.max(1, Number(q.limit ?? 200) || 200));
    const now = Date.now();
    const since = parsed.ok ? now - parsed.ms : now - 15 * 60_000;

    const wantModelId = (q.modelId ?? "").trim();
    const wantStatus = (q.status ?? "").trim();

    const rows = ctx.modelRequests
      .getRecent(50_000)
      .filter((r) => r.ts >= since && r.ts <= now)
      .filter((r) => (wantModelId ? r.modelId === wantModelId : true))
      .filter((r) => (wantStatus ? String(r.status) === wantStatus : true))
      .slice(0, lim)
      .map((r) => ({
        ts: r.ts,
        requestId: r.requestId,
        modelId: r.modelId,
        endpoint: r.endpoint,
        status: r.status,
        latencyMs: r.latencyMs,
        usage: r.usage ?? null,
      }));

    return { logs: rows };
  });

  app.get("/admin/models/:modelId/debug/messages", { preHandler: guard }, async (req) => {
    const params = req.params as { modelId: string };
    const q = req.query as { limit?: string; roles?: string };
    const lim = Math.min(50, Math.max(1, Number(q.limit ?? 10) || 10));
    const rolesRaw = String(q.roles ?? "system,user")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const roles = rolesRaw.filter((r) => r === "system" || r === "user") as MessageDebugRole[];

    const items = ctx.modelMessages.getRecent(params.modelId, lim, roles);
    return {
      messages: items.map((m) => ({
        id: m.id,
        ts: m.ts,
        modelId: m.modelId,
        requestId: m.requestId,
        endpoint: m.endpoint,
        role: m.role,
        rawMessageJson: m.rawMessageJson,
      })),
    };
  });

  app.get("/admin/requests/:requestId", { preHandler: guard }, async (req, reply) => {
    const params = req.params as { requestId: string };
    const found = ctx.modelRequests.getById(params.requestId);
    if (!found) {
      reply.code(404);
      return { error: { message: "Not found" } };
    }
    return {
      request: {
        ts: found.ts,
        requestId: found.requestId,
        modelId: found.modelId,
        endpoint: found.endpoint,
        status: found.status,
        latencyMs: found.latencyMs,
        usage: found.usage ?? null,
        error: found.error ?? null,
      },
    };
  });

  app.get("/admin/requests", { preHandler: guard }, async (req) => {
    const q = req.query as { limit?: string };
    const lim = Math.min(
      500,
      Math.max(1, Number(q.limit ?? 200) || 200),
    );
    return { requests: ctx.recorder.getRecent(lim) };
  });
}
