---
owner: @maintainers
last-reviewed: 2026-04-15
status: reviewed
audience: maintainer
---

# Publish `llmog` to npm

This runbook describes how the **npm package** `llmog` is built, verified, and published. The canonical automation lives in [`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml). Root [`README.md`](../../../README.md) covers install and runtime; this document is for **releasers** only.

## What gets published

- **Package name:** `llmog` (see root `package.json`).
- **Included files:** only `dist/` and `ui/dist/` (`files` in `package.json`). The full `npm run build` produces both (Vite UI, then TypeScript).
- **Lifecycle:** `prepublishOnly` runs `npm run build` again at publish time, so a clean publish always rebuilds artifacts.

## Prerequisites

1. **Node.js 20+** (matches CI and `engines` in `package.json`).
2. **GitHub Actions:** repository secret **`NPM_TOKEN`** — an npm access token with permission to publish this package (classic token with *Publish*, or granular token scoped to the package).
3. **Local publish (optional):** `npm login` or `NODE_AUTH_TOKEN` / `.npmrc` configured for the same scope as the package (unscoped public package).

## Recommended flow: GitHub Release → CI publish

This is the preferred path: one release artifact on GitHub, npm publish in a controlled environment.

### Steps

1. **Merge** release work to **`main`** (CI on `main` and PRs should be green).
2. **Bump version** in `package.json` (and lockfile if your process updates it) — must be **strictly greater** than the latest version on npm, or publish will fail.
3. **Commit and push** the version bump to `main`.
4. **Create a GitHub Release** and set it to **Published** (not draft). The workflow triggers on `release: types: [published]`.
5. **Watch** the **Publish to npm** workflow in GitHub Actions. It runs:
   - `npm ci`
   - `npm run build`
   - `npm test`
   - `npm pack --dry-run`
   - `npm publish --access public`
6. **Verify:** `npm view llmog version` matches the release, or install with `npx llmog@<version> --help`.

### Manual workflow dispatch

The workflow also supports **`workflow_dispatch`**. Use only when you understand why a normal release is not appropriate; you still need **`NPM_TOKEN`** and a correct `package.json` version on the branch you run against.

## Local flow: scripts (maintainer machine)

Use when you intentionally publish from a workstation (npm credentials on that machine).

### `scripts/publish.sh`

- Requires branch **`main`** or **`master`**.
- Requires a **clean** git working tree (no uncommitted changes).
- Runs `npm run build`, `npm test`, then `npm publish --access public`.

From repo root:

```bash
./scripts/publish.sh
```

### `scripts/release-and-publish.sh`

Interactive helper that:

1. Prompts for **`patch`**, **`minor`**, or **`major`**.
2. Runs `npm version <type> -m "chore: bump version to %s [skip ci]"` (commit + tag).
3. Calls `./scripts/publish.sh`.
4. Pushes **`main`** and **tags** to `origin`.

**Caveat:** the script hard-codes `git push origin main`. If your default branch is not `main`, adjust the script or use manual `npm version` + `publish.sh` + push.

From repo root:

```bash
./scripts/release-and-publish.sh
```

## Pre-release checklist (copy-paste)

- [ ] `main` is up to date and CI is green for the commit you are releasing.
- [ ] `package.json` `version` is bumped and not already on npm.
- [ ] Changelog or release notes updated if the project tracks them (optional for this repo).
- [ ] **`NPM_TOKEN`** is valid in GitHub repo secrets (for CI path).
- [ ] For local publish: working tree clean; on `main`/`master`; logged in to npm.
- [ ] After publish: confirm `npm view llmog` and smoke-test `npx llmog --help`.

## Troubleshooting

| Symptom | Likely cause | What to do |
| :--- | :--- | :--- |
| `403` / `ENEEDAUTH` on CI | Missing or expired **`NPM_TOKEN`** | Regenerate token; update repo secret; re-run workflow. |
| `403` “cannot publish over existing version” | Version already on registry | Bump `package.json` again; new commit/tag/release. |
| `publish.sh` exits before publish | Not on `main`/`master` or dirty tree | Commit/stash; checkout correct branch. |
| Package missing UI at `/ui` | `ui/dist` not in tarball | Ensure `npm run build` succeeds (Vite + `tsc`); check `npm pack --dry-run` lists `ui/dist`. |

## Related files

- [`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml) — automated publish.
- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) — build, test, `npm pack --dry-run` on push/PR.
- [`scripts/publish.sh`](../../../scripts/publish.sh), [`scripts/release-and-publish.sh`](../../../scripts/release-and-publish.sh) — local automation.
- Root [`package.json`](../../../package.json) — `files`, `prepublishOnly`, `version`.
