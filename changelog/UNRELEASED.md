# Unreleased

## UI (admin `/ui/`)

- **Playground:** Composer action row groups model picker, Stop, and **Send** (primary) on the right with tight `gap-2`; dropdown menu aligns to the trigger end.
- **Playground:** Message transcript scroll area is a column flex container so the bordered transcript panel stretches to the full available height above the composer (short threads no longer leave a short inner card).
- **Playground:** Deep slate / near-black surfaces aligned with Models (`bg-card`, `bg-background`, `border-border`) for sidebar, main shell, parameters strip, transcript panel, and composer + action bar; neutral chat chips; sliders use theme primary on `muted` tracks; **New chat** uses a low-contrast muted outline; primary send action labeled **Send** with `Send` icon; model picker icons toned to `muted-foreground`. Session list still dims while the message composer is focused (sidebar hover restores readability). Radix model dropdown + `data-testid="pg-model-trigger"`, global `Mod+I` and `/` focus shortcuts unchanged.
- **Playground:** Temperature / max-tokens slider thumbs use `bg-primary` with a light `primary-foreground` border and shadow so the handle reads clearly on dark cards (replacing `bg-card` thumbs that blended into the strip).
- **Playground:** Message composer textarea uses Cursor/VS Code–style thin scrollbar (WebKit + Firefox) tinted with `muted-foreground` tokens; explicit `max-h-48` / `overflow-y-auto` when content exceeds the composer cap.
- **Playground:** Message composer shell uses solid black (`bg-black` / `border-zinc-800`) for the model + Send bar block; the message textarea uses transparent border and background so text sits directly on that black surface.
- **Playground:** Composer textarea: focus ring and edge border at ~50% strength (`ring-ring/50`, `border-zinc-600/50`); caret uses full white with `caret-width: 2px`; placeholder uses `muted-foreground` at 80% opacity.
- Add `@radix-ui/react-dropdown-menu` and `ui/src/components/ui/dropdown-menu.tsx`; extend `Slider` with optional `trackClassName` / `rangeClassName` / `thumbClassName` for contextual styling.
- Adopt Tailwind CSS v3, PostCSS, and Shadcn-style primitives (Radix: Sheet, Collapsible, Slider, Button, Input, Label, Card) with `globals.css` design tokens.
- Add `ui/components.json`, path alias `@/*` → `ui/src/*`, and vendored `ui/src/components/ui/*` plus `cn` helper.
- Redesign shell (glass sidebar, Lucide icons, zinc depth) and migrate Configuration (model + env sheets, gradient add, row status feedback), Playground (bubbles, collapsible system, sliders), Monitoring (stat sparklines, table hover, cards), Models / Model detail / Probe for visual consistency.
- Remove legacy `ui/src/app.css` in favor of Tailwind layers.
- Dependencies: Radix UI, CVA, `tailwind-merge`, `clsx`, `tailwindcss-animate`, `framer-motion`, `lucide-react`.

## Verification

- After UI changes, refresh Playwright visual snapshots (`pnpm run test:visual:update` then `pnpm run test:visual`).

## Tests

- `tests/e2e/visual.spec.ts`: selectors updated for Tailwind layout (`main h1`, `getByTestId("pg-model-trigger")` for Playground model control, “Total requests” instead of legacy `.page` / `.gridCards`).
- Playwright visual baselines under `tests/e2e/visual.spec.ts-snapshots/` refreshed (`pnpm run test:visual:update`); `configuration.png` and `monitoring.png` updated on this run (other routes already matched).
