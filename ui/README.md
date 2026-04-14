# llmog Web UI

This folder is the **React + Vite** dashboard for the llmog gateway. It is a quick map of **layout, hash routes, and which Admin API calls each screen uses**. For overall system design (Fastify, admin guard, HTTP surface), see [`../architecture.md`](../architecture.md) and the root [`README.md`](../README.md).

There is **no** `package.json` under `ui/`; install scripts and build commands live at the **repository root**.

---

## Directory layout

```
ui/
├── vite.config.ts          # base: "/ui/", build output → ui/dist/
├── index.html
├── tsconfig.json
└── src/
    ├── main.tsx            # React entry
    ├── app.css             # Global tokens, layout (`.shell`, `.sidebar`, …)
    ├── App.tsx             # App shell, hash routing, Monitoring time-range state
    ├── components/
    │   └── Drawer.tsx      # Slide-over panel (env, request detail, message preview)
    ├── lib/
    │   ├── api.ts          # fetch helpers for same-origin `/admin/*` and `/v1/*`
    │   ├── chatCompletionStream.ts  # SSE client for Playground streaming
    │   ├── hashRoute.ts    # parse/set `#/…` routes (configuration … probe)
    │   └── time.ts         # Monitoring range keys: 15m | 1h | 24h
    └── pages/
        ├── ConfigurationPage.tsx
        ├── MonitoringPage.tsx
        ├── ModelsPage.tsx
        ├── PlaygroundPage.tsx
        ├── ProbePage.tsx         # Endpoint probe (OpenAI-compatible discovery)
        └── ModelDetailPage.tsx   # NOT wired into App.tsx — see “Unused / orphan code”
```

---

## Hash routes

Navigation is **client-side only** (no full page reload). The shell reads `window.location.hash` and renders one page.

| Hash | Screen |
| :--- | :--- |
| `#/configuration` (or empty / `#`) | Configuration |
| `#/monitoring` | Monitoring |
| `#/models` | Models |
| `#/playground` | Playground (chat + templates) |
| `#/probe` | Endpoint probe (OpenAI-compatible `POST /admin/discover-upstream-models`) |

**Legacy:** `#/models/...` (e.g. old model-detail URLs) is parsed in [`src/App.tsx`](src/App.tsx) and **redirected to the Models screen** (same view as `#/models`).

**Full URL shape:** with the gateway’s default static mount, open the app as **`{base}/ui/#/{route}`** (Vite `base: "/ui/"`).

---

## Screen → files → Admin API → server

`fetch` calls are **same-origin** to `/admin/*` and **`/v1/*`** (OpenAI-compatible surface). Admin handlers are implemented in [`../src/admin/routes.ts`](../src/admin/routes.ts); chat/models routes live on the main Fastify app in [`../src/server.ts`](../src/server.ts).

| Hash / screen | Primary file | Endpoints used (representative) | Server |
| :--- | :--- | :--- | :--- |
| Configuration | [`src/pages/ConfigurationPage.tsx`](src/pages/ConfigurationPage.tsx) | `GET/PUT /admin/config`, `GET/PUT /admin/env`, `POST /admin/reload`, `POST /admin/test-connection`, `POST /admin/discover-upstream-models` | `src/admin/routes.ts` |
| Monitoring | [`src/pages/MonitoringPage.tsx`](src/pages/MonitoringPage.tsx) | `GET /admin/metrics/overview?range=`, `GET /admin/logs/models?range=…&limit=…`, `GET /admin/requests/:requestId` | idem |
| Models | [`src/pages/ModelsPage.tsx`](src/pages/ModelsPage.tsx) | `GET /admin/config`, `GET /admin/models/:modelId/debug/messages?limit=…&roles=…` | idem |
| Playground | [`src/pages/PlaygroundPage.tsx`](src/pages/PlaygroundPage.tsx) | `GET /v1/models`, `POST /v1/chat/completions` (SSE), `GET/PUT /admin/playground/templates` | `src/server.ts` + `src/admin/routes.ts` |
| Endpoint probe | [`src/pages/ProbePage.tsx`](src/pages/ProbePage.tsx) | `POST /admin/discover-upstream-models` (`openai_compatible` only in this screen) | `src/admin/routes.ts` |

The Monitoring **range** control (`15m` / `1h` / `24h` in [`src/lib/time.ts`](src/lib/time.ts)) matches the `range` query parameter for `overview` and `logs/models`.

---

## Not used by the current UI

Some Admin routes exist for APIs or tooling but **are not called** by the SPA today. Example: **`GET /admin/metrics/summary`** (JSON snapshot from in-process metrics). If you add a new screen that uses them, update this README and the table above.

---

## Unused / orphan code

[`src/pages/ModelDetailPage.tsx`](src/pages/ModelDetailPage.tsx) is **not imported** anywhere. Model detail is handled inside **Models** (`ModelsPage.tsx`). Do not assume `ModelDetailPage` is a live route unless you wire it into `App.tsx`.

---

## Designer / UX overview

**Design tokens** (dark theme, spacing, cards, charts) live in [`src/app.css`](src/app.css): e.g. `--background`, `--card`, `--border`, `--text`, `--muted`, chart colors `--chart-in` / `--chart-out`, and layout classes below.

### App shell

- **`.shell`**: CSS grid, **240px sidebar** + fluid main column, full viewport height.
- **`.sidebar`**: Left rail with **`.brand`** (`llmog`) and **`.nav`** — **`.navItem`** buttons (Configuration, Monitoring, Models, Playground). Active state uses a light cyan-tinted background and border (see `.navItem.active`).
- **`.content`**: Main area where the active page mounts. Hash changes **do not** reload the document.

### Configuration

**Goal:** Edit gateway config and environment, validate connectivity, reload from disk.

- **Primary content:** Model list / editor tied to `PUT /admin/config`, validation, **Fetch models** from the upstream via `POST /admin/discover-upstream-models`, and **Test connection** via `POST /admin/test-connection`.
- **Primary actions:** Save config, **Reload** (`POST /admin/reload`), discover models, test connection, open **Manage env** in a **Drawer** (`.drawer` / overlay pattern in `app.css`).
- **Patterns:** Forms, tables, secondary buttons; **Drawer** for environment editing (not a separate route).

### Monitoring

**Goal:** Time-range overview of traffic and errors, drill into a single request.

- **Primary content:** Overview metrics for the selected **range** (`15m` / `1h` / `24h`), aligned with `GET /admin/metrics/overview?range=`, plus model-scoped logs from `GET /admin/logs/models?...`.
- **Primary actions:** Change range; select a row or item to open **Drawer** with request detail from `GET /admin/requests/:requestId`.
- **Patterns:** Summary cards, simple charts (CSS/SVG using chart color tokens), tables, **Drawer** for deep detail.

### Models

**Goal:** Inspect models from config, recent activity, and captured debug messages.

- **Primary content:** List driven by `GET /admin/config`; per-model debug messages via `GET /admin/models/:modelId/debug/messages?...`.
- **Primary actions:** Select a model; open a message in **Drawer** for read-only detail.
- **Patterns:** Tables, **Drawer** for message preview.

### Playground

**Goal:** Try chat completions against configured models with optional system instruction and parameters; save named **templates** (persisted server-side via admin API).

- **Primary content:** Model selector from `GET /v1/models`; message thread and streaming via `POST /v1/chat/completions` with `stream: true`; template library from `GET /admin/playground/templates`, saves with `PUT /admin/playground/templates`.
- **Primary actions:** New chat, send/stop, apply/delete templates, save current settings as a template.
- **Patterns:** Two-column layout (`.playgroundLayout`), sidebar library + main chat (see `.playgroundPage` in `app.css`).

### Endpoint probe

**Goal:** From the browser, ask the gateway to call **`GET /v1/models`** on an OpenAI-compatible base URL (same flow as discovery for that adapter), avoiding CORS.

- **Primary content:** Base URL + optional API key; results from `POST /admin/discover-upstream-models` with `adapter: "openai_compatible"`.
- **Primary actions:** **Fetch models**.

---

## Visual regression

Automated **visual regression** uses **Playwright** (`@playwright/test`) and `expect(page).toHaveScreenshot()` against a **built** UI (`pnpm build:ui`), served by **`vite preview`** (see root **`playwright.config.ts`**).

| Topic | Notes |
| :--- | :--- |
| **Spec** | `tests/e2e/visual.spec.ts` — hash routes `#/configuration`, `#/monitoring`, `#/models`, `#/playground`, `#/probe`. |
| **Baseline** | Reference PNGs under `tests/e2e/visual.spec.ts-snapshots/` (committed; review when UI changes are intentional). |
| **Scripts** | `pnpm test:visual` — build UI then `playwright test`; `pnpm test:visual:update` — same with `--update-snapshots`. |
| **Determinism** | **`page.route` mocks** in the spec for `/admin/*`, `/v1/models`, and stub `/v1/chat/completions`; fixtures in **`tests/e2e/fixtures/admin-api.ts`**. |
| **CI parity** | GitHub Actions runs VRT on **Linux**; to refresh baselines with the same environment as CI, use **`scripts/vrt-update-snapshots-docker.sh`** (requires Docker). |
| **Viewport** | Desktop Chrome, **1280×720**, `en-US` / `UTC` (see Playwright config). |

**Vitest** covers unit tests (e.g. admin Zod parse helpers); full-page VRT is a separate **e2e** flow from `vitest run`.

---

## Development and build (from repo root)

| Task | Command |
| :--- | :--- |
| Install | `pnpm install` |
| Production UI bundle | `pnpm build:ui` → output **`ui/dist/`** |
| Full build (UI + server) | `pnpm build` |
| Vite dev server (no separate `ui/` package) | `pnpm exec vite --config ui/vite.config.ts` |

**Same-origin:** Open the dashboard through the **llmog HTTP server** that also serves `/ui/` and `/admin/*` (e.g. after `pnpm build` + `pnpm start`, or `pnpm dev` with UI built if you need the bundle). That avoids extra CORS and matches how cookies and admin guards behave in production.

For default bind addresses, health checks, and localhost restrictions on `/admin/*` when binding to non-loopback interfaces, see the root **README** and **architecture** docs.
