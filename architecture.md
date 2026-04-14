# Project Architecture: llmog

`llmog` is a lightweight gateway that routes OpenAI-compatible HTTP requests to local or remote LLM backends (Ollama, vLLM, OpenAI-compatible servers, etc.) through a single unified endpoint.

## Overview

The proxy is a **standardization layer**: clients use one base URL and the usual OpenAI-style payloads; the server maps the requested `model` id to a backend via `models.json`, then the matching **adapter** translates the call to that provider’s API.

## High-Level Architecture

1. **Program entry (`src/index.ts`)**  
   Reads `PORT`, `HOST`, and optional `MODELS_PATH`. Loads config via `loadModelsFile` from `src/config/load.ts` (same resolution order as the CLI), then calls `buildServer({ bindHost: host, initial: loaded })` and listens. Default bind is `0.0.0.0:8787` unless overridden.

2. **CLI (`src/cli/`, binary `llmog`)**
   Commander-based commands (see `src/cli/`). `start` resolves `models.json` from `--models`, then `MODELS_PATH`, then `~/.config/llmog/models.json` (canonical), then `~/.config/llm-proxy/models.json`, then `~/.config/llm-open-gateway/models.json` (legacy, backward compat). It passes the resolved load result into `buildServer({ bindHost, initial })` so metadata matches the running process. CLI `start` default bind is `127.0.0.1:8787` when unset.

3. **Server (`src/server.ts`)**  
   Fastify application: OpenAI-style public routes, **Admin API** (`/admin/*`), optional **local Web UI** static assets under `/ui/` (when `ui/dist` exists), request/request+model history recording, error handling, and observability. Runtime config is held in a mutable **state** object (models file + active config path); `PUT /admin/config` and `POST /admin/reload` update that state without restarting the process.

4. **Routing**  
   For `POST /v1/chat/completions`, the body’s `model` must match an entry in the loaded config. `resolveModelConfig` returns that entry; `createAdapter` picks the implementation.

5. **Adapters (`src/adapters/`)**  
   Shared contract `LlmAdapter` in `base.ts`: `chatCompletions` and optional `chatCompletionsStream`. Implementations:
   - `ollama.ts` — Ollama HTTP API; non-stream and stream responses attach synthesized **`usage`** for clients and metrics.
   - `openaiCompatible.ts` — any OpenAI-compatible `/v1/chat/completions` backend
   - `deepseek.ts` — DeepSeek API mapping (adapter id `deepseek`)
   Factory: `adapters/index.ts` (`createAdapter`).

6. **HTTP helpers (`src/http.ts`)**  
   `fetch`-based `postJson` / `postJsonStream` used by adapters (timeouts, optional per-model headers) plus `joinUrl` to preserve any base URL path prefix.

7. **Configuration**  
   - **`src/config.ts`** — `resolveModelConfig` (shared lookup + 400 on unknown model); also includes a simple `loadModelsFile(modelsPath?)` helper that loads `cwd/models.json` by default.  
   - **`src/config/load.ts`** — Reads JSON, validates with Zod (`ModelsFileSchema`), resolves CLI/env/project/user paths, exposes `ConfigValidationError` / `formatConfigError`. Also supports `${ENV_VAR}` expansion for `apiKey` fields (missing env var removes the field so validation can still succeed).  
   - **`src/config/schema.ts`** — Zod schemas for `models.json` (duplicate `id` checks, URL validation).  
   - **`src/config/paths.ts`** — Default paths and filesystem helpers. Exports `canonicalUserModelsPath` (`~/.config/llmog/models.json`) plus legacy fallbacks for `~/.config/llm-proxy/models.json` and `~/.config/llm-open-gateway/models.json`.

8. **Observability (`src/observability/`)**  
   - **`metrics.ts`** — Prometheus (`prom-client`): HTTP counters/histograms, upstream error counter, token counters; scrape endpoint `GET /metrics`.  
   - **`requestId.ts`** — Request id from `x-request-id` or a new UUID; echoed on responses.  
   - **`tokenUsage.ts`** — Best-effort extraction of usage from JSON and SSE chunks for logging and metrics; **`usageFromOllamaGenerateWithRawFallback`** builds OpenAI-shaped counts from Ollama `prompt_eval_count` / `eval_count` or a rough text-length heuristic.  
   - **`requestRecorder.ts`** — In-memory bounded ring buffer of recent requests (for `GET /admin/requests`).  
   - **`modelRequestStore.ts`** — In-memory per-request log for model calls (for `/admin/metrics/*`, `/admin/logs/models`, `/admin/requests/:requestId`).  
   - **`modelMessageDebugStore.ts`** — In-memory per-model ring buffer of selected input messages (roles `system`/`user`) for deep-debug (for `GET /admin/models/:modelId/debug/messages`).  
   - **`summary.ts`** — Builds a small JSON summary for `GET /admin/metrics/summary` from existing metrics (uptime, HTTP totals, mean latency from the histogram).

9. **Admin & UI (`src/admin/`, `ui/`)**  
   - **`admin/auth.ts`** — When the server is bound to a non-loopback address (e.g. `0.0.0.0`), requests to `/admin/*` are guarded to localhost (`127.0.0.1`, `::1`, or IPv4-mapped `::ffff:127.0.0.1`). UI routes (`/` and `/ui/*`) are also guarded. Loopback-only binds skip this check.  
   - **`admin/configStore.ts`** — Validates JSON with the same Zod schema as disk load; resolves **write target** (writable loaded file vs fallback `~/.config/llmog/models.json`); atomic file write for saves.  
   - **`admin/playgroundTemplatesStore.ts`** — Reads/writes **`playground-templates.json`** beside the active config write target (or under `~/.config/llmog/` when no directory can be inferred), validated with Zod; serves `GET/PUT /admin/playground/templates`.  
   - **`admin/upstreamDiscover.ts`** — `discoverUpstreamModels`: `GET` Ollama **`/api/tags`**, OpenAI-compatible **`/v1/models`**, or DeepSeek’s models listing; used by `POST /admin/discover-upstream-models`.  
   - **`admin/routes.ts`** — Registers Admin API handlers.  
   - **`version.ts`** — Reads `version` from `package.json` for `GET /admin/health`.  
   - **`ui/`** — Vite + React app (build output `ui/dist/`). Production `pnpm build` runs `build:ui` then TypeScript. The server serves static files with `@fastify/static` and redirects `GET /` → `/ui/` when assets are present. A maintained map of the **`ui/`** tree, hash routes, and which **Admin API** each screen calls lives in **[`ui/README.md`](ui/README.md)**—read it when modifying the dashboard. **Visual regression** uses Playwright `toHaveScreenshot` against `vite preview` with `page.route` mocks (`tests/e2e/visual.spec.ts`, fixtures under `tests/e2e/fixtures/`); hash routes **configuration**, **monitoring**, **models**, **playground**, and **probe** have baselines. Root scripts `test:visual` / `test:visual:update` are in **`package.json`**; CI runs the same spec on Linux. Vitest covers unit tests (including playground templates and discovery helpers) separately.

## HTTP Surface

### Public API (OpenAI-compatible)

| Route | Role |
| :--- | :--- |
| `GET /healthz` | Liveness: process is up. |
| `GET /readyz` | Readiness; `?deep=1` probes each model’s `baseUrl` with a short `GET`. |
| `GET /metrics` | Prometheus text exposition. |
| `GET /v1/models` | OpenAI-style model list from configured ids. |
| `POST /v1/chat/completions` | Chat completions; supports `stream: true` (SSE) when the adapter implements streaming. |

### Admin API (local tooling; localhost-only when not loopback-bound)

| Route | Role |
| :--- | :--- |
| `GET /admin/health` | Server version, active config path. |
| `GET /admin/config` | Current validated config + metadata (`loadedFromPath`, `writeTarget`, `configSource`, `configGeneration`). |
| `PUT /admin/config` | Replace config (validated); writes to the resolved write target and updates in-memory state. |
| `POST /admin/reload` | Reload config from `activeConfigPath` on disk into memory. |
| `POST /admin/test-connection` | Probe upstream `GET` for a `modelId` or a draft `{ adapter, baseUrl, model }` (draft adapter supports `ollama` and `openai_compatible`). |
| `POST /admin/discover-upstream-models` | List upstream model ids for `{ adapter, baseUrl }` (optional `apiKey`, `timeoutMs`): Ollama tags, OpenAI `/v1/models`, or DeepSeek-compatible discovery. |
| `GET /admin/metrics/summary` | JSON snapshot derived from prom-client metrics (uptime, counts, mean latency). |
| `GET /admin/metrics/overview?range=15m\|1h\|24h` | Token + request overview from in-memory model logs (p50/p95 latency, error rate, timeseries). |
| `GET /admin/logs/models?range=&modelId=&status=&limit=` | Recent per-model request logs (from the in-memory store). |
| `GET /admin/models/:modelId/debug/messages?limit=&roles=system,user` | Recent captured `system`/`user` input messages for that model (deep-debug). |
| `GET /admin/playground/templates` | Saved Playground templates (JSON file on disk; default empty list if missing). |
| `PUT /admin/playground/templates` | Replace the full templates list (validated); atomic write to `playground-templates.json` next to the config write target or under `~/.config/llmog/`. |
| `GET /admin/requests/:requestId` | Request detail by id (from the in-memory model store). |
| `GET /admin/requests?limit=` | Recent requests from the in-memory recorder (no bodies or sensitive headers). |

### Web UI (optional static)

| Route | Role |
| :--- | :--- |
| `GET /` | Redirects to `/ui/` when `ui/dist` exists. |
| `GET /ui/*` | Static assets for the dashboard (Configuration, Monitoring, Models, Playground, Endpoint probe); same-origin `/admin/*` and `/v1/*` from the browser. |

In-app navigation uses **hash routes** (for example `#/configuration`); see [`ui/README.md`](ui/README.md) for the canonical list and how they map to Admin handlers.

**Note:** `HOST` defaults differ: `src/index.ts` defaults to `0.0.0.0`; CLI `start` defaults to `127.0.0.1` when unset. When listening on all interfaces, Admin and UI routes enforce localhost as described above.

## Data Flow

### Non-streaming

`Client` → `Fastify` → resolve `model` → `createAdapter` → adapter `chatCompletions` → upstream → JSON body → optional usage extraction → metrics / response logs → client.

### Streaming (SSE)

`Client (stream: true)` → `Fastify` → adapter `chatCompletionsStream` → response body piped to raw Node response; for `text/event-stream`, bytes stream through while SSE blocks are scanned for usage → token metrics and access logs → client.

## Key Components

| Piece | Responsibility |
| :--- | :--- |
| **Fastify** | Routing, hooks, raw streaming for SSE. |
| **`models.json` / `ModelConfig`** | Maps proxy `id` → `adapter`, `baseUrl`, upstream `model`, optional `headers`, `timeoutMs`. |
| **`LlmAdapter`** | `chatCompletions` / optional `chatCompletionsStream`. |
| **Adapters** | Protocol-specific mapping to Ollama vs OpenAI-compatible APIs. |
| **Zod schemas** | Validate config at load time. |
| **Metrics + token usage** | Operational visibility without changing client APIs. |
| **Admin API + UI** | Local configuration, metrics summary, and request history without changing `/v1/*` contracts. |
| **Request recorder** | Bounded ring buffer for debug-oriented request metadata. |

## Configuration (`models.json`)

Adapter values are **`ollama`**, **`openai_compatible`** (underscore), and **`deepseek`**. Example:

```json
{
  "models": [
    {
      "id": "ollama-llama3",
      "adapter": "ollama",
      "baseUrl": "http://localhost:11434",
      "model": "llama3"
    },
    {
      "id": "vllm-openai",
      "adapter": "openai_compatible",
      "baseUrl": "http://localhost:8000",
      "model": "meta-llama/Meta-Llama-3-8B-Instruct",
      "apiKey": "your-token",
      "timeoutMs": 120000
    }
  ]
}
```

**Auth:** optional **`apiKey`** is sent as `Authorization: Bearer <apiKey>` by default. Use **`apiKeyHeader`** (e.g. `"x-api-key"`) to send the key in another header instead (value only, no `Bearer`). Optional **`headers`** are merged on top (same header name → `headers` wins). For unusual schemes you can still set everything via **`headers`** alone. You can also reference secrets as `${ENV_VAR}` in `apiKey`.

## Environment Variables (common)

| Variable | Purpose |
| :--- | :--- |
| `PORT` | Listen port (e.g. `8787`). |
| `HOST` | Bind address (entry script default `0.0.0.0`; CLI `start` default `127.0.0.1` if unset). |
| `MODELS_PATH` | Absolute or relative path to `models.json`. |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error`; also enables Fastify’s logger when set. |
| `REQUEST_HISTORY_MAX` | Max entries in the admin request-history ring buffer (default `200`, capped). |
| `MODEL_REQUEST_HISTORY_MAX` | Max entries in the model-request store (used for `/admin/metrics/*` and logs). |
| `NODE_ENV` | Conventional environment label (logged at startup). |

## Technology Stack

- **Runtime**: Node.js  
- **Framework**: Fastify  
- **Language**: TypeScript  
- **Validation**: Zod  
- **CLI**: Commander  
- **Metrics**: prom-client (Prometheus)  
- **Tests**: Vitest; Playwright (visual regression in `tests/e2e/`)  
- **Package manager**: pnpm  
- **Web UI (dev/build)**: Vite, React (output under `ui/dist/`, served in production by Fastify)  
