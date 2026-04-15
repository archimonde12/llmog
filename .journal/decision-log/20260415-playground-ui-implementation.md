# Playground UI implementation (2026-04-15)

## Defaults applied

- **Typography:** Inter (sans) + JetBrains Mono (mono) via Google Fonts in `ui/index.html`, Tailwind `theme.extend.fontFamily`, body uses `font-sans`.
- **Playground chrome:** Sidebar background `#020617`, main panel `#0F172A`, composer surface `#1E293B` with optional `backdrop-blur` when motion is not reduced (`usePrefersReducedMotion`).
- **Model picker:** `@radix-ui/react-dropdown-menu` + shadcn-style `ui/src/components/ui/dropdown-menu.tsx`; trigger `data-testid="pg-model-trigger"` for VRT; provider icons from heuristic on `id` / `owned_by` with `Box` fallback.
- **Primary CTA:** Label **Execute** with `Play` icon, gradient `#8B5CF6` → `#EC4899`, stronger shadow on hover.
- **Shortcuts:** `Mod+I` and `/` (only when not typing in an input/textarea/select/contenteditable) focus the message composer; Enter (no Shift) still sends.
- **New chat:** Neon-style outline violet + `Plus` icon; session rows use dividers and `Trash2` revealed on row hover.

## Notes

- Visual regression baselines updated under `tests/e2e/visual.spec.ts-snapshots/` after UI change.
