import { Command } from "commander";
import { buildServer } from "../../server";
import { loadModelsFile, formatConfigError } from "../../config/load";
import { logListenBanner, logStartupPreamble } from "../../startupLog";

type StartOptions = {
  models?: string;
  port?: string;
  host?: string;
};

export function startCommand() {
  const cmd = new Command("start");
  cmd
    .description("Start the llm-proxy server.")
    .option("--models <path>", "Path to models.json")
    .option("--port <port>", "Port to listen on (default: 8787)")
    .option("--host <host>", "Host to bind (default: 127.0.0.1)")
    .action(async (opts: StartOptions) => {
      const port = Number(opts.port ?? process.env.PORT ?? 8787);
      const host = String(opts.host ?? process.env.HOST ?? "127.0.0.1");

      const loaded = await loadModelsFile({
        cliFlagPath: opts.models,
        envPath: process.env.MODELS_PATH,
      }).catch((err) => {
        throw new Error(formatConfigError(err));
      });

      logStartupPreamble({
        nodeVersion: process.version,
        nodeEnv: process.env.NODE_ENV ?? "development",
        host,
        port,
        modelsPath: loaded.source.path,
        modelsSourceKind: loaded.source.kind,
        createdDefaultModelsFile: loaded.createdDefaultFile,
      });

      const app = await buildServer({ bindHost: host, initial: loaded });
      const address = await app.listen({ port, host });
      logListenBanner({ address: String(address), port });
    });

  return cmd;
}

