import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { loadModelsFileFromPath } from "./config/load";
import type { ResolvedModelsSource } from "./config/load";
import { resolveModelConfig } from "./config";
import { createAdapter } from "./adapters";
import { OpenAIChatCompletionsRequest } from "./types";
import type { ModelsFile } from "./types";
import { createMetrics, registerMetrics } from "./observability/metrics";
import { genRequestId, registerRequestId } from "./observability/requestId";
import {
  extractUsageFromChatCompletionResponse,
  extractUsageFromSseChunk,
  NormalizedTokenUsage,
} from "./observability/tokenUsage";
import {
  isLocalhostRequest,
  sendForbiddenNonLocal,
  shouldEnforceLocalhostGuard,
} from "./admin/auth";
import { registerAdminRoutes, type RuntimeState } from "./admin/routes";
import { probeModelUpstream } from "./upstreamProbe";
import { RequestRecorder, requestHistoryCapacityFromEnv } from "./observability/requestRecorder";
import {
  ModelRequestStore,
  modelRequestHistoryCapacityFromEnv,
} from "./observability/modelRequestStore";
import { ModelMessageDebugStore } from "./observability/modelMessageDebugStore";
import { packageVersion } from "./version";

type LogLevel = "debug" | "info" | "warn" | "error";

function shouldLog(level: LogLevel) {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (!configured) return true;
  const order: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  const cfg = (["debug", "info", "warn", "error"] as const).includes(
    configured as any,
  )
    ? (configured as LogLevel)
    : "info";
  return order[level] >= order[cfg];
}

function logStreamIsTTY(level: LogLevel): boolean {
  return level === "error" || level === "warn"
    ? process.stderr.isTTY
    : process.stdout.isTTY;
}

function formatLogLine(
  level: LogLevel,
  message: string,
  meta?: Record<string, any>,
): string {
  if (!logStreamIsTTY(level)) {
    return meta ? `${message} ${JSON.stringify(meta)}` : message;
  }
  const badge: Record<LogLevel, string> = {
    debug: "\x1b[94m\x1b[2m[debug]\x1b[0m",
    info: "\x1b[96m[info]\x1b[0m",
    warn: "\x1b[33m\x1b[1m[warn]\x1b[0m",
    error: "\x1b[31m\x1b[1m[error]\x1b[0m",
  };
  if (!meta) {
    return `${badge[level]} ${message}`;
  }
  // meta: dim but readable (avoid dark gray)
  return `${badge[level]} ${message} \x1b[2m\x1b[37m${JSON.stringify(meta)}\x1b[0m`;
}

function log(level: LogLevel, message: string, meta?: Record<string, any>) {
  if (!shouldLog(level)) return;
  const line = formatLogLine(level, message, meta);
  // eslint-disable-next-line no-console
  (level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.log)(line);
}

async function pipeWebStreamToNode(
  stream: ReadableStream<Uint8Array>,
  res: import("node:http").ServerResponse,
) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

async function pipeSseWebStreamToNodeWithUsage(
  adapter: import("./types").ModelAdapterType,
  stream: ReadableStream<Uint8Array>,
  res: import("node:http").ServerResponse,
  onUsage: (usage: NormalizedTokenUsage) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const maybeHandleEvent = (eventBlock: string) => {
    const lines = eventBlock.split("\n");
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trimStart();
      if (!data || data === "[DONE]") continue;
      try {
        const obj = JSON.parse(data);
        const usage = extractUsageFromSseChunk(adapter, obj);
        if (usage) onUsage(usage);
      } catch {
        // ignore non-JSON chunks
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      res.write(Buffer.from(value));

      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1024 * 1024) buffer = buffer.slice(-256 * 1024);

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block) maybeHandleEvent(block);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export type BuildServerOptions = {
  bindHost: string;
  initial?: { modelsFile: ModelsFile; source: ResolvedModelsSource };
  /** When set, load this file (tests / simple callers). Ignored if `initial` is set. */
  modelsPath?: string;
};

export async function buildServer(opts: BuildServerOptions) {
  const app = Fastify({
    logger: process.env.LOG_LEVEL ? true : false,
    genReqId: genRequestId as any,
  });

  let state: RuntimeState;
  if (opts.initial) {
    state = {
      modelsFile: opts.initial.modelsFile,
      activeConfigPath: path.resolve(opts.initial.source.path),
      bootstrapSource: opts.initial.source,
      configGeneration: 1,
    };
  } else if (opts.modelsPath) {
    const abs = path.resolve(opts.modelsPath);
    const mf = await loadModelsFileFromPath(abs);
    state = {
      modelsFile: mf,
      activeConfigPath: abs,
      bootstrapSource: { kind: "cli_flag", path: abs },
      configGeneration: 1,
    };
  } else {
    throw new Error("buildServer: provide initial or modelsPath");
  }

  const metrics = createMetrics();
  const recorder = new RequestRecorder(requestHistoryCapacityFromEnv());
  const modelRequests = new ModelRequestStore(modelRequestHistoryCapacityFromEnv());
  const modelMessages = new ModelMessageDebugStore(10);
  const enforceLocalhost = shouldEnforceLocalhostGuard(opts.bindHost);
  const pkgV = packageVersion();

  if (enforceLocalhost) {
    app.addHook("onRequest", async (req, reply) => {
      const p = (req.url ?? "").split("?")[0] ?? "";
      if (p === "/" || p.startsWith("/ui")) {
        if (!isLocalhostRequest(req)) return sendForbiddenNonLocal(reply);
      }
    });
  }

  await registerRequestId(app);
  await registerMetrics(app, metrics);

  app.addHook("onResponse", async (req, reply) => {
    const startAt = (req as any).__startAt as bigint | undefined;
    const durationMs = startAt
      ? Number(process.hrtime.bigint() - startAt) / 1e6
      : 0;
    const url = req.url.split("?")[0] ?? req.url;
    const modelId = (req as any).__modelId as string | undefined;
    const modelAdapter = (req as any).__modelAdapter as string | undefined;
    const tokens = (req as any).__tokenUsage as NormalizedTokenUsage | undefined;
    let error: string | undefined;
    if (reply.statusCode >= 400) {
      error = `HTTP ${reply.statusCode}`;
    }
    recorder.record({
      requestId: String(req.id),
      ts: Date.now(),
      method: req.method,
      path: url,
      status: reply.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
      modelId,
      adapter: modelAdapter,
      error,
    });

    if (modelId && url === "/v1/chat/completions") {
      modelRequests.record({
        ts: Date.now(),
        requestId: String(req.id),
        modelId,
        endpoint: url,
        status: reply.statusCode,
        latencyMs: Math.round(durationMs * 1000) / 1000,
        usage:
          tokens &&
          (typeof tokens.tokensIn === "number" ||
            typeof tokens.tokensOut === "number" ||
            typeof tokens.tokensTotal === "number")
            ? {
                prompt_tokens: tokens.tokensIn,
                completion_tokens: tokens.tokensOut,
                total_tokens: tokens.tokensTotal,
              }
            : undefined,
        error,
      });
    }
  });

  app.addHook("onRequest", async (req) => {
    (req as any).__startAt = process.hrtime.bigint();
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!path.startsWith("/admin")) {
      log("info", "incoming_request", {
        id: req.id,
        method: req.method,
        url: req.url,
        ip: req.ip,
      });
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    const startAt = (req as any).__startAt as bigint | undefined;
    const durationMs = startAt
      ? Number(process.hrtime.bigint() - startAt) / 1e6
      : undefined;
    const modelId = (req as any).__modelId as string | undefined;
    const modelAdapter = (req as any).__modelAdapter as string | undefined;
    const tokens = (req as any).__tokenUsage as NormalizedTokenUsage | undefined;
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!path.startsWith("/admin")) {
      log("info", "request_complete", {
        id: req.id,
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        durationMs: durationMs ? Math.round(durationMs * 1000) / 1000 : undefined,
        modelId,
        adapter: modelAdapter,
        tokensIn: tokens?.tokensIn,
        tokensOut: tokens?.tokensOut,
        tokensTotal: tokens?.tokensTotal,
      });
    }
  });

  app.setErrorHandler(async (err, req, reply) => {
    const statusCode =
      typeof (err as any)?.statusCode === "number"
        ? (err as any).statusCode
        : 500;
    log("error", "request_error", {
      id: req.id,
      method: req.method,
      url: req.url,
      statusCode,
      message: (err as any)?.message,
    });
    reply.code(statusCode);
    return { error: { message: (err as any)?.message ?? "Internal error" } };
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (req, reply) => {
    const deep = (req.query as any)?.deep === "1" || (req.query as any)?.deep === 1;
    if (!deep) return { ok: true };

    const checks = await Promise.all(
      state.modelsFile.models.map(async (m) => {
        const base = m.baseUrl.replace(/\/+$/, "");
        const r = await probeModelUpstream({
          ...m,
          timeoutMs: Math.min(m.timeoutMs ?? 1500, 5000),
        });
        return {
          id: m.id,
          ok: r.ok,
          status: r.status,
          baseUrl: base,
          ...(!r.ok ? { error: r.message } : {}),
        };
      }),
    );

    const allOk = checks.every((c) => c.ok);
    if (!allOk) reply.code(503);
    return { ok: allOk, upstreams: checks };
  });

  app.get("/v1/models", async () => {
    return {
      object: "list",
      data: state.modelsFile.models.map((m) => ({
        id: m.id,
        object: "model",
        owned_by: "local",
      })),
    };
  });

  app.post<{ Body: OpenAIChatCompletionsRequest }>(
    "/v1/chat/completions",
    async (req, reply) => {
      if (!req.body || typeof req.body !== "object") {
        reply.code(400);
        return { error: { message: "Missing JSON body" } };
      }

      try {
        const modelCfg = resolveModelConfig(state.modelsFile, req.body.model);
        const adapter = createAdapter(modelCfg);
        (req as any).__modelId = modelCfg.id;
        (req as any).__modelAdapter = modelCfg.adapter;

        log("info", "chat_completions", {
          id: req.id,
          model: modelCfg.id,
          stream: Boolean(req.body.stream),
        });

        // Capture input messages for deep-debug (per-model ring buffer, roles system/user only).
        const endpoint = "/v1/chat/completions";
        const msgs = (req.body as any)?.messages;
        if (Array.isArray(msgs)) {
          for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            const role = (m as any)?.role;
            if (role !== "system" && role !== "user") continue;
            modelMessages.record({
              id: `${String(req.id)}:${i}:${role}`,
              ts: Date.now(),
              modelId: modelCfg.id,
              requestId: String(req.id),
              endpoint,
              role,
              rawMessageJson: m,
            });
          }
        }

        if (req.body.stream) {
          if (!adapter.chatCompletionsStream) {
            reply.code(400);
            return {
              error: {
                message: `Model '${modelCfg.id}' does not support streaming`,
              },
            };
          }

          const streamResult = await adapter.chatCompletionsStream(req.body);
          const contentType =
            streamResult.headers["content-type"] ??
            "text/event-stream; charset=utf-8";

          reply.raw.statusCode = streamResult.status;
          reply.raw.setHeader("content-type", contentType);
          reply.raw.setHeader(
            "cache-control",
            streamResult.headers["cache-control"] ?? "no-cache",
          );
          reply.raw.setHeader(
            "connection",
            streamResult.headers["connection"] ?? "keep-alive",
          );

          if (!streamResult.body) {
            reply.raw.end();
            return reply;
          }

          const streamUsage: { current: NormalizedTokenUsage | null } = {
            current: null,
          };
          const recordUsage = (u: NormalizedTokenUsage) => {
            streamUsage.current = u;
          };

          if (String(contentType).toLowerCase().includes("text/event-stream")) {
            await pipeSseWebStreamToNodeWithUsage(
              modelCfg.adapter,
              streamResult.body,
              reply.raw,
              recordUsage,
            );
          } else {
            await pipeWebStreamToNode(streamResult.body, reply.raw);
          }

          const lastUsage = streamUsage.current;
          if (lastUsage && streamResult.status >= 200 && streamResult.status < 300) {
            metrics.observeTokens({
              modelId: modelCfg.id,
              adapter: modelCfg.adapter,
              ...lastUsage,
            });
            (req as any).__tokenUsage = lastUsage;
          }

          reply.raw.end();
          return reply;
        } else {
          const result = await adapter.chatCompletions(req.body);
          reply.code(result.status);
          reply.header("content-type", "application/json");

          const usage = extractUsageFromChatCompletionResponse(
            modelCfg.adapter,
            result.body,
          );
          if (usage && result.status >= 200 && result.status < 300) {
            metrics.observeTokens({
              modelId: modelCfg.id,
              adapter: modelCfg.adapter,
              ...usage,
            });
            (req as any).__tokenUsage = usage;
          }

          return result.body;
        }
      } catch (err: any) {
        const statusCode =
          typeof err?.statusCode === "number" ? err.statusCode : 502;
        reply.code(statusCode);
        const modelId = (req as any).__modelId;
        const modelAdapter = (req as any).__modelAdapter;
        if (modelId && modelAdapter && statusCode >= 500) {
          metrics.upstreamErrorsTotal.inc(
            { model_id: String(modelId), adapter: String(modelAdapter) },
            1,
          );
        }
        return { error: { message: err?.message ?? "Upstream error" } };
      }
    },
  );

  await registerAdminRoutes(app, {
    state,
    metrics,
    recorder,
    modelRequests,
    modelMessages,
    packageVersion: pkgV,
    enforceLocalhost,
  } as any);

  const uiDist = path.join(__dirname, "..", "ui", "dist");
  if (fs.existsSync(uiDist)) {
    await app.register(fastifyStatic, {
      root: uiDist,
      prefix: "/ui/",
    });
    app.get("/", async (_req, reply) => reply.redirect("/ui/", 302));
  }

  return app;
}
