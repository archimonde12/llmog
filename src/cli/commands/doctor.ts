import { Command } from "commander";
import { loadModelsFile, formatConfigError } from "../../config/load";
import type { ModelsFile } from "../../types";
import net from "node:net";

type DoctorOptions = {
  models?: string;
  url?: string;
  host?: string;
  port?: string;
  deep?: boolean;
};

async function checkPortFree(host: string, port: number) {
  return await new Promise<boolean>((resolve) => {
    const srv = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => srv.close(() => resolve(true)))
      .listen(port, host);
  });
}

async function pingUrl(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.message ?? String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function checkUpstreams(modelsFile: ModelsFile) {
  const results: Array<{ id: string; baseUrl: string; ok: boolean; detail: string }> = [];
  for (const m of modelsFile.models) {
    const base = m.baseUrl.replace(/\/+$/, "");
    const r = await pingUrl(base, Math.min(m.timeoutMs ?? 1500, 5000));
    results.push({
      id: m.id,
      baseUrl: base,
      ok: r.ok,
      detail: r.ok ? `HTTP ${r.status}` : r.error ? `ERROR ${r.error}` : `HTTP ${r.status}`,
    });
  }
  return results;
}

export function doctorCommand() {
  const cmd = new Command("doctor");
  cmd
    .description("Run quick diagnostics (config parse, port check, upstream reachability).")
    .option("--models <path>", "Path to models.json")
    .option("--host <host>", "Host to bind for port check (default: 127.0.0.1)")
    .option("--port <port>", "Port to check (default: 8787)")
    .option("--deep", "Ping upstream baseUrl for each model", false)
    .action(async (opts: DoctorOptions) => {
      const host = String(opts.host ?? "127.0.0.1");
      const port = Number(opts.port ?? 8787);

      let modelsFile: ModelsFile;
      let sourcePath: string;
      try {
        const loaded = await loadModelsFile({
          cliFlagPath: opts.models,
          envPath: process.env.MODELS_PATH,
        });
        modelsFile = loaded.modelsFile as unknown as ModelsFile;
        sourcePath = loaded.source.path;
        if (loaded.createdDefaultFile) {
          // eslint-disable-next-line no-console
          console.log(
            `note: created starter models.json (example Ollama model) at ${sourcePath}`,
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(formatConfigError(err));
        process.exitCode = 1;
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`config: OK (${sourcePath})`);

      const portFree = await checkPortFree(host, port);
      // eslint-disable-next-line no-console
      console.log(`port: ${host}:${port} ${portFree ? "available" : "IN USE"}`);

      const warnings: string[] = [];
      const ids = new Set<string>();
      for (const m of modelsFile.models) {
        if (ids.has(m.id)) warnings.push(`duplicate id: ${m.id}`);
        ids.add(m.id);
        if (!/^https?:\/\//.test(m.baseUrl)) warnings.push(`baseUrl missing protocol for ${m.id}: ${m.baseUrl}`);
      }
      for (const w of warnings) {
        // eslint-disable-next-line no-console
        console.warn(`warn: ${w}`);
      }

      if (opts.deep) {
        const upstreams = await checkUpstreams(modelsFile);
        for (const u of upstreams) {
          // eslint-disable-next-line no-console
          console.log(`upstream: ${u.id} ${u.baseUrl} ${u.ok ? "OK" : "FAIL"} (${u.detail})`);
        }
        if (upstreams.some((u) => !u.ok)) process.exitCode = 1;
      }
    });

  return cmd;
}

