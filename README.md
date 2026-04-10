# llm-proxy

**llm-proxy** is a lightweight, high-performance gateway designed to unify multiple LLM backends (Ollama, vLLM, OpenAI-compatible servers, etc.) into a single, standardized OpenAI-compatible API endpoint.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![Package Manager](https://img.shields.io/badge/package-pnpm-ff6302.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%233178c6.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-black?logo=fastify)](https://www.fastify.io/)
[![Build Status](https://img.shields.io/badge/build%20passing-%234caf50.svg)](#)

---

## Key features

*   **Unified interface**: Access different backends (Ollama, vLLM, etc.) using the standard OpenAI SDK and payload format.
*   **Multi-backend support**: Seamlessly route requests to various providers via a simple `models.json` configuration.
*   **Dynamic configuration**: Update your model list and backend URLs on-the-fly via the **Admin API** without restarting the server.
*   **Built-in observability**:
    *   **Prometheus metrics**: Monitor request counts, latency, and token usage.
    *   **Request history**: Track recent requests via an in-memory buffer.
*   **Web UI**: A built-in dashboard to manage configuration, environment variables, and monitoring (when `ui/dist` is present).
*   **Streaming**: Full support for Server-Sent Events (SSE) for real-time chat completions.
*   **Lightweight and fast**: Built with **Fastify** and **TypeScript** for minimal overhead and maximum throughput.

---

## Quick start

### Prerequisites

*   [Node.js](https://nodejs.org/) (**v20+ required**)
*   [pnpm](https://pnpm.io/)

### Installation

**From npm (global CLI)** — no clone required; the published package includes `dist/` and `ui/dist` (dashboard at `/ui` when you run the server).

```bash
npm install -g @archimonde12/llm-proxy
```

Requires **Node.js 20+** (see `engines` in `package.json`). After installing, run `llm-proxy --help` or `llm-proxy start`.

**Without global install (npx):**

```bash
npx @archimonde12/llm-proxy --help
```

Configuration file resolution is described under [Configuration](#configuration) (important when using a global install from arbitrary working directories).

**From source** (development):

```bash
# Clone the repository (replace OWNER with your fork or upstream)
git clone https://github.com/OWNER/llm-proxy.git
cd llm-proxy

# Install dependencies
pnpm install
```

### Running the server

**Development** (TypeScript; no production UI bundle required for API-only work):

```bash
pnpm dev
```

In **development** (`pnpm dev`), the default bind is **0.0.0.0:8787** (override with `HOST` and `PORT`). In **`llm-proxy start`** / **`pnpm start`**, the default bind is **127.0.0.1:8787** unless you set `HOST`, `PORT`, or pass `--host` / `--port`.

**Production** (compiled server and built web UI):

```bash
npm run build   # or: pnpm build — Vite UI bundle + TypeScript; produces ui/dist and dist/
pnpm start      # or: npm start — runs node dist/index.js
```

A full build always runs the UI step first, so `ui/dist` is present afterward. Maintainers can use **npm** or **pnpm** for `build` / `start`; the build script does not invoke `pnpm` internally.

### CLI (`llm-proxy`)

With **`npm install -g @archimonde12/llm-proxy`**, use the `llm-proxy` command on your `PATH`.

From a **source** tree after `npm run build` / `pnpm build`:

```bash
pnpm cli -- <subcommand> [options]
# equivalent:
node dist/cli/bin.js <subcommand> [options]
```

| Command | Purpose |
| :--- | :--- |
| `init` | Create a starter `models.json` (wizard when interactive; use `-y` for defaults). Options: `--file <path>`, `-y` / `--yes`. |
| `start` | Start the HTTP server. Options: `--models <path>`, `--port <port>` (default **8787**), `--host <host>` (default **127.0.0.1**). |
| `status` | Call public **`GET /healthz`**. Options: `--url <baseUrl>` (default `http://127.0.0.1:8787`). |
| `doctor` | Validate config, check listen port, optionally ping upstreams. Options: `--models <path>`, `--host`, `--port`, `--deep`. |
| `config validate` | Validate `models.json` against the schema. Options: `--file <path>` (default `./models.json`). |

### Environment variables (server / CLI)

| Variable | Used by | Description |
| :--- | :--- | :--- |
| `MODELS_PATH` | `pnpm dev`, `start`, `doctor` | Path to `models.json`. For `start` and `doctor`, only used when `--models` is omitted; `pnpm dev` always resolves the file from env / defaults (no `--models` flag). |
| `PORT` | `pnpm dev`, `start` | Listen port if unset (default **8787**); `start` also accepts `--port`. |
| `HOST` | `pnpm dev`, `start` | Bind address if unset — **`pnpm dev`** defaults to **0.0.0.0**, **`start`** defaults to **127.0.0.1**; `start` also accepts `--host`. |
| `LOG_LEVEL` | Server | Optional: `debug`, `info`, `warn`, or `error`; omit to log at all levels. |

---

## Configuration

The proxy uses a `models.json` file to map your custom model IDs to specific backends.

**Resolution order** (see [`src/config/load.ts`](src/config/load.ts)):

1. **`llm-proxy start --models <path>`** — explicit file path.
2. **`MODELS_PATH`** — if set, that path is used (a starter file is created if missing).
3. **Otherwise:** **`./models.json`** relative to the **current working directory** — if it exists, it is used.
4. **Otherwise:** **`~/.config/llm-proxy/models.json`** — canonical user config; if it exists, it is used (good default for a **global** install when you are not in a project directory).
5. **Otherwise:** **`~/.config/llm-open-gateway/models.json`** — legacy path for backward compatibility with older installs; used only if the canonical path above does not exist.
6. **Otherwise:** a starter `models.json` is created at **`./models.json`** in the current working directory.

This means a global install does not require a checkout: use a file in the cwd, set `MODELS_PATH`, pass `--models`, or keep your config under `~/.config/llm-proxy/models.json`.

### Example `models.json`

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
      "id": "vllm-mixtral",
      "adapter": "openai_compatible",
      "baseUrl": "http://localhost:8000",
      "model": "mixtral-8x7b",
      "apiKey": "your-secret-api-key"
    }
  ]
}
```

### Supported adapters

| Adapter | Description |
| :--- | :--- |
| `ollama` | Optimized for the [Ollama](https://ollama.com/) HTTP API. |
| `openai_compatible` | Any server implementing the OpenAI `/v1/chat/completions` contract. |
| `deepseek` | DeepSeek-compatible HTTP API (see [`src/adapters/deepseek.ts`](src/adapters/deepseek.ts)). |

### Optional fields (per model)

| Field | Description |
| :--- | :--- |
| `apiKey` | Secret sent to the upstream (see **Secrets** below). |
| `apiKeyHeader` | Header name for the API key (requires `apiKey`). |
| `headers` | Extra static headers as string key/value pairs. |
| `timeoutMs` | Upstream request timeout in milliseconds. |

### Secrets: `apiKey` and `${ENV_VAR}`

To avoid committing raw keys, you can set `apiKey` to a **single** environment placeholder: the string must be exactly `${` + the variable name + `}`, where the name uses only letters, digits, and underscores. On load, the server replaces that string with the value from `process.env`. If the variable is unset or empty, `apiKey` is dropped so the rest of the entry can still pass validation.

After changing environment variables (for example via **`PUT /admin/env`**), call **`POST /admin/reload`** so `${...}` placeholders are resolved again from the updated process environment.

---

## Web UI (dashboard)

The UI is a static SPA served from **`ui/dist`**. The server registers it **only if that directory exists**; otherwise there is no **`GET /`** redirect to the app (see [`src/server.ts`](src/server.ts)).

**Prerequisite:** run **`pnpm build:ui`** or a full **`pnpm build`** before starting the server if you want the dashboard.

**URLs**

* **`GET /`** → **302** to **`/ui/`** when the UI bundle is present.
* Static assets are served under **`/ui/`**.

**In-app routes** (hash-based):

* **`#/configuration`** — Edit `models.json` and environment variables through the Admin API.
* **`#/monitoring`** — Metrics overview with time ranges **15m**, **1h**, and **24h** (aligned with `/admin/metrics/overview`).
* **`#/models`** — Model list, request logs, and debug message capture.

**Security:** When the process binds to a non-loopback address, **`/admin/*`** and **`/ui/*`** are restricted to localhost clients. To use the dashboard remotely, use local access, SSH port forwarding, or a tunnel you trust.

**UI development:** There is no separate `package.json` under `ui/`; for a local Vite dev server you can run e.g. `pnpm exec vite --config ui/vite.config.ts` from the repo root. Production assets are built with **`pnpm build:ui`**.

---

## Admin API, health, and metrics

*Note: Admin routes are restricted to `localhost` when the server is bound to a non-loopback interface.*

### Public health (no admin guard)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Liveness: returns `{ ok: true }` while the process is running. Used by **`llm-proxy status`**. |
| `GET` | `/readyz` | Readiness. With **`?deep=1`**, probes each model's upstream; may return **503** if any probe fails. |

### Admin API (localhost when exposed on a public bind)

**Config and environment**

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/admin/health` | Process/version hint and active config path (not the same as public `/healthz`). |
| `GET` | `/admin/config` | Current configuration, write target, and metadata. |
| `PUT` | `/admin/config` | Replace configuration (validated); writes atomically. |
| `POST` | `/admin/reload` | Reload `models.json` from disk. |
| `GET` | `/admin/env` | List relevant env keys and `.env` file metadata. |
| `PUT` | `/admin/env` | Apply env updates to `.env` and `process.env`. |

**Connectivity and metrics**

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `/admin/test-connection` | Probe a configured **`modelId`** or an inline adapter/baseUrl/model payload. |
| `GET` | `/admin/metrics/summary` | JSON snapshot from in-process metrics. |
| `GET` | `/admin/metrics/overview` | Overview for **`range=15m`**, **`1h`**, or **`24h`** (query param). |

**Logs and requests**

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/admin/requests` | Recent proxy request history (`limit` query param, capped). |
| `GET` | `/admin/requests/:requestId` | Single request record by id. |
| `GET` | `/admin/logs/models` | Model-scoped logs with **`range`**, optional **`modelId`**, **`status`**, **`limit`**. |
| `GET` | `/admin/models/:modelId/debug/messages` | Recent captured **system** / **user** messages for debugging (`limit`, **`roles`**). |

### Prometheus

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/metrics` | Prometheus text exposition format. |

---

## Security and exposure

If you intend to expose `llm-proxy` to the internet (e.g., via **ngrok** or a reverse proxy), please follow these best practices:

1.  **Use HTTPS**: Always use an SSL/TLS tunnel or terminating proxy.
2.  **Admin and UI**: The server restricts `/admin/*` and `/ui/*` to localhost when it detects a non-loopback bind.
3.  **Upstream credentials**: Use `apiKey` / `${ENV_VAR}` in `models.json` for provider authentication.

**Example with ngrok:**

```bash
ngrok http 8787
```

---

## Contributing

Pull requests are welcome; please keep changes focused and consistent with existing patterns.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
