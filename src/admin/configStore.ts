import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { defaultUserModelsPath } from "../config/paths";
import type { ModelsFile } from "../types";
import { ModelsFileSchema } from "../config/schema";

export async function isPathWritableAsFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    try {
      await access(filePath, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  } catch {
    const parent = path.dirname(filePath);
    try {
      await access(parent, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * If the loaded config file path is writable (or can be created), use it.
 * Otherwise fall back to ~/.config/llmog/models.json.
 */
export async function resolveWriteTarget(loadedFrom: string): Promise<{
  writeTarget: string;
  usedAlternate: boolean;
}> {
  const abs = path.resolve(loadedFrom);
  if (await isPathWritableAsFile(abs)) {
    return { writeTarget: abs, usedAlternate: false };
  }
  return { writeTarget: defaultUserModelsPath(), usedAlternate: true };
}

export function parseModelsFileJson(raw: unknown): {
  ok: true;
  data: ModelsFile;
} | {
  ok: false;
  issues: { path: string; message: string }[];
} {
  const res = ModelsFileSchema.safeParse(raw);
  if (!res.success) {
    return {
      ok: false,
      issues: res.error.issues.map((i) => ({
        path: pathToString(i.path as (string | number)[]),
        message: i.message,
      })),
    };
  }
  return { ok: true, data: res.data };
}

function pathToString(p: (string | number)[]): string {
  if (!p.length) return "<root>";
  let out = "";
  for (const seg of p) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : String(seg);
  }
  return out;
}

export async function writeModelsFileAtomic(
  filePath: string,
  data: ModelsFile,
): Promise<void> {
  const abs = path.resolve(filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, json, "utf8");
  await rename(tmp, abs);
}
