import fs from "node:fs/promises";
import path from "node:path";
import { createDefaultModelsFile } from "./defaultModelsFile";
import {
  canonicalUserModelsPath,
  ensureParentDir,
  fileExists,
  legacyProxyUserModelsPath,
  legacyUserModelsPath,
} from "./paths";
import { ModelsFileSchema, type ModelsFile } from "./schema";

export type ResolvedModelsSource =
  | { kind: "cli_flag"; path: string }
  | { kind: "env"; path: string }
  | { kind: "project_default"; path: string }
  | { kind: "user_default"; path: string };

export function resolveModelsPath(input?: { cliFlagPath?: string; envPath?: string; cwd?: string }) {
  const cliFlagPath = input?.cliFlagPath?.trim();
  if (cliFlagPath) {
    return { kind: "cli_flag", path: path.resolve(cliFlagPath) } as const;
  }

  const envPath = input?.envPath?.trim();
  if (envPath) {
    return { kind: "env", path: path.resolve(envPath) } as const;
  }

  const canonical = canonicalUserModelsPath();
  return { kind: "user_default", path: canonical } as const;
}

export async function resolveExistingModelsPath(input?: {
  cliFlagPath?: string;
  envPath?: string;
  cwd?: string;
}): Promise<ResolvedModelsSource> {
  const resolved = resolveModelsPath(input);
  if (resolved.kind === "user_default") {
    const canonical = canonicalUserModelsPath();
    if (await fileExists(canonical)) return { kind: "user_default", path: canonical };
    const legacyProxy = legacyProxyUserModelsPath();
    if (await fileExists(legacyProxy)) return { kind: "user_default", path: legacyProxy };
    const legacy = legacyUserModelsPath();
    if (await fileExists(legacy)) return { kind: "user_default", path: legacy };
    return { kind: "user_default", path: canonical };
  }
  return resolved;
}

export class ConfigValidationError extends Error {
  readonly issues: { path: string; message: string }[];
  readonly filePath: string;

  constructor(args: { filePath: string; issues: { path: string; message: string }[] }) {
    super(
      `Invalid config at ${args.filePath}\n` +
      args.issues.map((i) => `- ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ConfigValidationError";
    this.issues = args.issues;
    this.filePath = args.filePath;
  }
}

function zodPathToString(p: Array<string | number>) {
  if (p.length === 0) return "<root>";
  let out = "";
  for (const seg of p) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out;
}

export async function loadModelsFileFromPath(filePath: string): Promise<ModelsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err: any) {
    const e = new Error(`Failed to read models file at ${filePath}: ${err?.message ?? String(err)}`);
    (e as any).statusCode = 500;
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err: any) {
    throw new ConfigValidationError({
      filePath,
      issues: [{ path: "<file>", message: `Invalid JSON: ${err?.message ?? String(err)}` }],
    });
  }

  // Allow secrets to be referenced as ${ENV_VAR} in config without committing raw keys.
  // If the env var is missing, the field is removed so validation can still succeed.
  if (parsed && typeof parsed === "object") {
    const maybeModels = (parsed as any).models;
    if (Array.isArray(maybeModels)) {
      for (const m of maybeModels) {
        if (!m || typeof m !== "object") continue;
        const ak = (m as any).apiKey;
        if (typeof ak === "string") {
          const match = /^\$\{([A-Z0-9_]+)\}$/.exec(ak.trim());
          if (match) {
            const envName = match[1]!;
            const envVal = (process.env as any)[envName];
            if (typeof envVal === "string" && envVal.trim()) (m as any).apiKey = envVal.trim();
            else delete (m as any).apiKey;
          }
        }
      }
    }
  }

  const res = ModelsFileSchema.safeParse(parsed);
  if (!res.success) {
    throw new ConfigValidationError({
      filePath,
      issues: res.error.issues.map((i) => ({
        path: zodPathToString(
          (i.path as Array<string | number | symbol>).map((seg) =>
            typeof seg === "symbol" ? String(seg) : seg,
          ) as Array<string | number>,
        ),
        message: i.message,
      })),
    });
  }
  return res.data;
}

/**
 * Same as {@link loadModelsFileFromPath} but does not substitute `${ENV_VAR}` in apiKey.
 * Use for admin UI so secrets stay referenced as in models.json.
 */
export async function loadModelsFileFromPathAsStored(filePath: string): Promise<ModelsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err: any) {
    const e = new Error(`Failed to read models file at ${filePath}: ${err?.message ?? String(err)}`);
    (e as any).statusCode = 500;
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err: any) {
    throw new ConfigValidationError({
      filePath,
      issues: [{ path: "<file>", message: `Invalid JSON: ${err?.message ?? String(err)}` }],
    });
  }

  const res = ModelsFileSchema.safeParse(parsed);
  if (!res.success) {
    throw new ConfigValidationError({
      filePath,
      issues: res.error.issues.map((i) => ({
        path: zodPathToString(
          (i.path as Array<string | number | symbol>).map((seg) =>
            typeof seg === "symbol" ? String(seg) : seg,
          ) as Array<string | number>,
        ),
        message: i.message,
      })),
    });
  }
  return res.data;
}

export type LoadedModelsFile = {
  modelsFile: ModelsFile;
  source: ResolvedModelsSource;
  /** True when a starter `models.json` was written because no file existed at the resolved path. */
  createdDefaultFile: boolean;
};

async function ensureMockModelsFileAtPath(filePath: string): Promise<boolean> {
  if (await fileExists(filePath)) return false;
  await ensureParentDir(filePath);
  const body = JSON.stringify(createDefaultModelsFile(), null, 2) + "\n";
  await fs.writeFile(filePath, body, "utf8");
  return true;
}

export async function loadModelsFile(input?: {
  cliFlagPath?: string;
  envPath?: string;
  cwd?: string;
}): Promise<LoadedModelsFile> {
  const cliFlagPath = input?.cliFlagPath?.trim();
  const envPath = input?.envPath?.trim();

  let source: ResolvedModelsSource;
  let createdDefaultFile = false;

  if (cliFlagPath) {
    const p = path.resolve(cliFlagPath);
    createdDefaultFile = await ensureMockModelsFileAtPath(p);
    source = { kind: "cli_flag", path: p };
  } else if (envPath) {
    const p = path.resolve(envPath);
    createdDefaultFile = await ensureMockModelsFileAtPath(p);
    source = { kind: "env", path: p };
  } else {
    // Resolve order: canonical user path -> legacy llm-proxy path -> legacy llm-open-gateway path.
    const canonical = canonicalUserModelsPath();
    if (await fileExists(canonical)) {
      source = { kind: "user_default", path: canonical };
    } else {
      const legacyProxy = legacyProxyUserModelsPath();
      if (await fileExists(legacyProxy)) {
        source = { kind: "user_default", path: legacyProxy };
      } else {
        const legacy = legacyUserModelsPath();
        if (await fileExists(legacy)) {
          source = { kind: "user_default", path: legacy };
        } else {
          createdDefaultFile = await ensureMockModelsFileAtPath(canonical);
          source = { kind: "user_default", path: canonical };
        }
      }
    }
  }

  const modelsFile = await loadModelsFileFromPath(source.path);
  return { modelsFile, source, createdDefaultFile };
}

export function isConfigValidationError(err: unknown): err is ConfigValidationError {
  return err instanceof ConfigValidationError;
}

export function formatConfigError(err: unknown) {
  if (isConfigValidationError(err)) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as any).message);
  return String(err);
}

