import fs from "node:fs";
import path from "node:path";

export function packageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const j = JSON.parse(raw) as { version?: string };
    return j.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
