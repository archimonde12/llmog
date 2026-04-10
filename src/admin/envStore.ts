import fs from "node:fs/promises";
import path from "node:path";

const ENV_KEY_RE = /^[A-Z0-9_]+$/;

export function resolveDotenvPath(): { path: string; source: "DOTENV_CONFIG_PATH" | "cwd" } {
  const configured = (process.env.DOTENV_CONFIG_PATH ?? "").trim();
  if (configured) return { path: path.resolve(configured), source: "DOTENV_CONFIG_PATH" };
  return { path: path.resolve(process.cwd(), ".env"), source: "cwd" };
}

export function listEnvKeys(): string[] {
  const keys = Object.keys(process.env ?? {}).filter((k) => ENV_KEY_RE.test(k));
  keys.sort();
  return keys;
}

/** Keys declared in the dotenv file (names only; no values). Missing file → []. */
export async function listKeysInDotenvFile(dotenvPath: string): Promise<string[]> {
  const entries = await listEntriesInDotenvFile(dotenvPath);
  const keys = entries.map((e) => e.key);
  keys.sort();
  return keys;
}

/** Key/value pairs from the dotenv file (localhost admin only). */
export async function listEntriesInDotenvFile(dotenvPath: string): Promise<Array<{ key: string; value: string }>> {
  let existing = "";
  try {
    existing = await fs.readFile(path.resolve(dotenvPath), "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const parsed = parseEnvLines(existing);
  const out: Array<{ key: string; value: string }> = [];
  for (const line of parsed) {
    if (line.kind === "kv" && ENV_KEY_RE.test(line.key)) {
      out.push({ key: line.key, value: line.value });
    }
  }
  return out;
}

type ParsedLine =
  | { kind: "kv"; key: string; rawKey: string; value: string; raw: string }
  | { kind: "other"; raw: string };

function parseEnvLines(raw: string): ParsedLine[] {
  const lines = raw.split(/\r?\n/);
  const out: ParsedLine[] = [];
  for (const line of lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) {
      out.push({ kind: "other", raw: line });
      continue;
    }
    const rawKey = m[1] ?? "";
    const key = rawKey.trim();
    const value = m[2] ?? "";
    out.push({ kind: "kv", key, rawKey, value, raw: line });
  }
  return out;
}

function normalizeEnvValue(v: string): string {
  // Keep as-is (no quoting rules). UI will paste raw tokens.
  return String(v);
}

export async function applyEnvUpdates(args: {
  dotenvPath: string;
  updates: Array<{ key: string; value: string | null }>;
}): Promise<{ writtenTo: string; changedKeys: string[] }> {
  const abs = path.resolve(args.dotenvPath);
  const updates = args.updates;

  for (const u of updates) {
    if (!ENV_KEY_RE.test(u.key)) {
      throw Object.assign(new Error(`Invalid env key '${u.key}'. Use A-Z0-9_ only.`), { statusCode: 400 });
    }
  }

  let existing = "";
  try {
    existing = await fs.readFile(abs, "utf8");
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
    existing = "";
  }

  const parsed = parseEnvLines(existing);
  const updateMap = new Map<string, string | null>();
  for (const u of updates) updateMap.set(u.key, u.value == null ? null : normalizeEnvValue(u.value));

  const seen = new Set<string>();
  const nextLines: string[] = [];

  for (const line of parsed) {
    if (line.kind !== "kv") {
      nextLines.push(line.raw);
      continue;
    }

    if (!ENV_KEY_RE.test(line.key)) {
      // Preserve non-standard keys untouched.
      nextLines.push(line.raw);
      continue;
    }

    if (!updateMap.has(line.key)) {
      nextLines.push(line.raw);
      continue;
    }

    seen.add(line.key);
    const nextVal = updateMap.get(line.key);
    if (nextVal == null) {
      // delete: skip line
      continue;
    }
    nextLines.push(`${line.key}=${nextVal}`);
  }

  // Append new keys (not present in file)
  const toAppend: string[] = [];
  for (const [k, v] of updateMap) {
    if (seen.has(k)) continue;
    if (v == null) continue;
    toAppend.push(`${k}=${v}`);
  }
  if (toAppend.length) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    nextLines.push(...toAppend);
  }

  const finalText = `${nextLines.join("\n").replace(/\n+$/, "")}\n`;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, finalText, "utf8");

  // Apply to runtime env without restart
  const changedKeys: string[] = [];
  for (const [k, v] of updateMap) {
    if (v == null) {
      if (k in process.env) changedKeys.push(k);
      delete (process.env as any)[k];
    } else {
      if (process.env[k] !== v) changedKeys.push(k);
      process.env[k] = v;
    }
  }

  return { writtenTo: abs, changedKeys };
}

