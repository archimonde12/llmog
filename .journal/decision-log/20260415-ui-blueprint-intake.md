# Decision log: UI blueprint intake (H.A.R.D.)

**Date:** 2026-04-15  
**Source:** User intake via AskQuestion (attached hard-ai-coding-workflow).

## Decisions recorded

| Topic | Choice |
|--------|--------|
| Task type | `new-feature` |
| Styling stack | Add **Tailwind** and migrate UI (away from CSS-token-only as primary styling). |
| Motion & icons | **Framer Motion** + **icon library** (e.g. Lucide) per blueprint direction. |
| Monitoring micro-charts | **Real data** wired to existing backend/state (not placeholder-only). |
| Visual regression | **Yes** — run and commit **Playwright snapshot** updates after redesign. |
| Risk / edge cases | **High** — full critical path + **accessibility** (contrast, `prefers-reduced-motion`). |

## Revision (same day — user: “đánh đổi đẹp, test ít đi một chút”)

| Topic | Revised choice |
|--------|----------------|
| Component stack | **Shadcn/ui (Tailwind + Radix)** — prioritize polished UI and less custom a11y/widget code. |
| Proof / testing | **Narrower automated proof**: keep **Playwright visual** (+ snapshot updates after redesign) as primary regression; **Vitest** only where logic warrants it; **no** broad property/exhaustive UI matrix. |
| Manual | **Smoke** critical flows: Configuration (add/edit/test connection), Playground (send messages), Monitoring (range change). |
| Accessibility | **Pragmatic bar**: sensible contrast + `prefers-reduced-motion` handling; **not** a full WCAG audit commitment. |

## Notes

- Official ADR in `docs/decisions/` only if user requests promote.
- ~~Next step: confirm Shadcn~~ — **Shadcn in scope** per revision above (tradeoff: beauty + fewer hand-written tests, Radix baseline for primitives).
