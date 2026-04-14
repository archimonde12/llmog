#!/usr/bin/env bash
# Regenerate Playwright screenshot baselines on Linux (matches CI). Requires Docker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.59.1-jammy}"
docker run --rm -v "$ROOT:/work" -w /work "$IMAGE" bash -c \
  "npm ci && npm run build:ui && npx playwright install chromium && npx playwright test tests/e2e/visual.spec.ts --update-snapshots"
