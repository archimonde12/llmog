import path from "node:path";
import dotenv from "dotenv";
import { resolveExistingModelsPath } from "./load";
import { fileExists } from "./paths";

/**
 * Minimal argv scan for bootstrap (before Commander runs). Supports `--models <path>` and `--models=<path>` anywhere after the program name.
 */
export function parseModelsFlagFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--models=")) {
      const v = arg.slice("--models=".length).trim();
      return v || undefined;
    }
    if (arg === "--models") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) return next.trim() || undefined;
      return undefined;
    }
  }
  return undefined;
}

/**
 * Load `.env` before config: `DOTENV_CONFIG_PATH` wins; else `.env` next to the
 * resolved models.json when that file exists; else `cwd/.env`.
 */
export async function loadDotenvForBootstrap(input?: { cliFlagPath?: string }): Promise<void> {
  const configured = (process.env.DOTENV_CONFIG_PATH ?? "").trim();
  if (configured) {
    dotenv.config({ path: path.resolve(configured) });
    return;
  }

  const resolved = await resolveExistingModelsPath({
    cliFlagPath: input?.cliFlagPath,
    envPath: process.env.MODELS_PATH,
  });

  const besideEnv = path.join(path.dirname(resolved.path), ".env");
  if (await fileExists(besideEnv)) {
    dotenv.config({ path: besideEnv });
    return;
  }

  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}
