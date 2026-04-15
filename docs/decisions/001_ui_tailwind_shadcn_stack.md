# ADR 001: Admin UI stack (Tailwind, Shadcn, Radix, Framer Motion, Lucide)

## Status

Accepted — 2026-04-15

## Context

The gateway ships a React admin UI under `/ui/` (Vite). Styling lived in a large hand-written `app.css`. We want a maintainable design system, accessible primitives, and room for light motion without changing `/admin/*` or `/v1/*` contracts.

## Decision

1. **Tailwind CSS (v3.x)** is the primary styling surface. PostCSS + Autoprefixer run as part of the existing Vite UI build. Global tokens and resets live in `ui/src/globals.css` with `@tailwind` layers and CSS variables aligned with Shadcn-style theming (zinc / dark).

2. **Shadcn UI (new-york preset)** — components are **vendored** into `ui/src/components/ui/` (Radix primitives + `class-variance-authority` + `tailwind-merge` + `clsx`). We add only the primitives required by the product: Sheet, Collapsible, Slider, Button, Input, Label, Card.

3. **Radix UI** underpins overlays and interactive widgets (Dialog for Sheet, Collapsible, Slider, Label). Focus management and keyboard behavior follow Radix defaults; we do not replace gateway APIs.

4. **Framer Motion** is included for optional, subtle transitions (e.g. sheet/backdrop). Usage stays **narrow**: no full route transitions in this iteration. Animations MUST respect `prefers-reduced-motion: reduce` (skip or shorten motion when reduced).

5. **Lucide React** supplies sidebar and inline icons (navigation, loaders, row actions).

6. **Package layout** — Dependencies remain in the **root** `package.json` (pnpm). `ui/components.json` documents Shadcn paths; **no** separate `ui/package.json` was required because components were added manually (avoids CLI/workspace friction). If future work adopts `shadcn` CLI from `ui/`, a minimal `ui/package.json` remains an optional escape hatch.

## Bundle / performance

- Accept modest JS increase from Radix + Framer for better UX and a11y. Tree-shaking and route-less SPA keep unused Radix modules out of chunks when not imported.
- Lucide: import icons by name (tree-shakeable).
- Framer: import only used APIs; gate motion on reduced-motion.

## Accessibility defaults

- Use semantic HTML and Radix-managed focus traps for Sheet/Dialog.
- Visible focus styles via Tailwind `ring` utilities on interactive controls.
- Sliders and collapsibles: preserve `aria-*` from Radix; labels tied with `Label` + `id` where applicable.
- Charts and sparklines: treat as decorative/supplementary; headline numbers remain plain text for screen readers.

## Consequences

- **Positive**: Faster iteration on UI, consistent components, less custom CSS to maintain.
- **Negative**: Larger `node_modules` and slightly larger UI bundle; team must follow Shadcn/Tailwind patterns when adding components.
- **Neutral**: Visual regression snapshots must be refreshed when visuals change.

## Alternatives considered

- **Tailwind v4-only**: Deferred; Shadcn ecosystem at time of implementation standardizes on Tailwind v3 for lowest friction.
- **Keep custom CSS only**: Rejected — high maintenance and weak component consistency.
- **MUI / Chakra**: Rejected — heavier opinion and different token model than desired “gateway console” look.
