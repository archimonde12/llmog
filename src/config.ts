import path from "node:path";
import type { ModelsFile } from "./types";
import { loadModelsFileFromPath } from "./config/load";

export async function loadModelsFile(modelsPath?: string): Promise<ModelsFile> {
  const resolved = modelsPath
    ? path.resolve(modelsPath)
    : path.resolve(process.cwd(), "models.json");
  return (await loadModelsFileFromPath(resolved)) as unknown as ModelsFile;
}

export function resolveModelConfig(
  modelsFile: ModelsFile,
  requestedModelId: string,
) {
  const match = modelsFile.models.find((m) => m.id === requestedModelId);
  if (!match) {
    const available = modelsFile.models.map((m) => m.id).sort();
    const err = new Error(
      `Unknown model '${requestedModelId}'. Available: ${available.join(", ")}`,
    );
    (err as any).statusCode = 400;
    throw err;
  }
  return match;
}
