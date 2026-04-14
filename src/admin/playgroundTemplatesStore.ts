import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { isPathWritableAsFile } from "./configStore";

/** ~/.config/llmog/playground-templates.json */
export function canonicalUserPlaygroundTemplatesPath(): string {
  return path.resolve(os.homedir(), ".config", "llmog", "playground-templates.json");
}

/**
 * Prefer `playground-templates.json` next to the active models config; if that path
 * is not writable, fall back to {@link canonicalUserPlaygroundTemplatesPath} (same idea as
 * {@link resolveWriteTarget} for models.json).
 */
export async function resolvePlaygroundTemplatesWriteTarget(loadedFrom: string): Promise<{
  writeTarget: string;
  usedAlternate: boolean;
}> {
  const absDir = path.dirname(path.resolve(loadedFrom));
  const besideConfig = path.join(absDir, "playground-templates.json");
  if (await isPathWritableAsFile(besideConfig)) {
    return { writeTarget: besideConfig, usedAlternate: false };
  }
  return { writeTarget: canonicalUserPlaygroundTemplatesPath(), usedAlternate: true };
}

export const PlaygroundTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemPrompt: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  defaultModelId: z.string().optional(),
});

export const PlaygroundTemplatesFileSchema = z
  .object({
    templates: z.array(PlaygroundTemplateSchema),
  })
  .superRefine((val, ctx) => {
    const seen = new Map<string, number>();
    for (let i = 0; i < val.templates.length; i++) {
      const id = val.templates[i]?.id;
      if (!id) continue;
      const prev = seen.get(id);
      if (prev !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["templates", i, "id"],
          message: `Duplicate id '${id}' (also at templates[${prev}].id)`,
        });
      } else {
        seen.set(id, i);
      }
    }
  });

export type PlaygroundTemplatesFile = z.infer<typeof PlaygroundTemplatesFileSchema>;

function pathToString(p: (string | number)[]): string {
  if (!p.length) return "<root>";
  let out = "";
  for (const seg of p) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : String(seg);
  }
  return out;
}

export function parsePlaygroundTemplatesJson(raw: unknown): {
  ok: true;
  data: PlaygroundTemplatesFile;
} | {
  ok: false;
  issues: { path: string; message: string }[];
} {
  const res = PlaygroundTemplatesFileSchema.safeParse(raw);
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

export async function writePlaygroundTemplatesFileAtomic(
  filePath: string,
  data: PlaygroundTemplatesFile,
): Promise<void> {
  const abs = path.resolve(filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, json, "utf8");
  await rename(tmp, abs);
}

/**
 * Reads and validates the JSON file, or returns an empty document if the file is missing.
 * Throws on I/O errors other than ENOENT, invalid JSON, or validation failure.
 */
export async function readPlaygroundTemplatesFile(filePath: string): Promise<PlaygroundTemplatesFile> {
  try {
    const rawText = await readFile(filePath, "utf8");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error(`Invalid JSON in playground templates file: ${filePath}`);
    }
    const parsed = parsePlaygroundTemplatesJson(parsedJson);
    if (!parsed.ok) {
      const detail = parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      throw new Error(`Invalid playground templates file: ${detail}`);
    }
    return parsed.data;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { templates: [] };
    }
    throw err;
  }
}
