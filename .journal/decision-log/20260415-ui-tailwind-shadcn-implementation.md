# Decision log: UI Tailwind + Shadcn implementation (2026-04-15)

## Context

Executed plan `llmog-20260415-ui-tailwind-shadcn`: migrate admin UI to Tailwind v3, vendored Shadcn/Radix components, Lucide, optional Framer on shell, without changing gateway API contracts.

## Decisions (execution)

- **Tailwind content paths**: PostCSS runs with repo CWD; `tailwind.config.ts` and `postcss.config.mjs` now use `__dirname`-anchored paths so `content` globs resolve under `ui/`.
- **Shadcn CLI vs manual**: Added `ui/components.json` but **did not** add `ui/package.json`; components were **vendored** under `ui/src/components/ui/` to avoid CLI/workspace friction (matches ADR 001).
- **Framer Motion**: Used on `App` brand only when reduced motion is off; Sheet uses Tailwind/Radix animations.
- **Visual tests**: Updated `tests/e2e/visual.spec.ts` selectors for new DOM (`main h1`, etc.) and regenerated PNGs under `tests/e2e/visual.spec.ts-snapshots/`.

## Official ADR

Promoted technical record: `docs/decisions/001_ui_tailwind_shadcn_stack.md`.
