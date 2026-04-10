import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

export function defaultProjectModelsPath(cwd: string = process.cwd()) {
  return path.resolve(cwd, "models.json");
}

/** Canonical user-level config path: ~/.config/llmog/models.json */
export function canonicalUserModelsPath() {
  return path.resolve(os.homedir(), ".config", "llmog", "models.json");
}

/**
 * Legacy user-level config path kept for backward compatibility with
 * older llm-proxy package naming.
 * ~/.config/llm-proxy/models.json
 */
export function legacyProxyUserModelsPath() {
  return path.resolve(os.homedir(), ".config", "llm-proxy", "models.json");
}

/**
 * Legacy user-level config path kept for backward compatibility with
 * installs that used the old package name "llm-open-gateway".
 * ~/.config/llm-open-gateway/models.json
 */
export function legacyUserModelsPath() {
  return path.resolve(os.homedir(), ".config", "llm-open-gateway", "models.json");
}

/** @deprecated Use {@link canonicalUserModelsPath} instead. */
export function defaultUserModelsPath() {
  return canonicalUserModelsPath();
}

export async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureParentDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
