import { buildServer } from "./server";
import { loadModelsFile } from "./config/load";
import { loadDotenvForBootstrap } from "./config/dotenvBootstrap";
import { logListenBanner, logStartupPreamble } from "./startupLog";

async function main() {
  await loadDotenvForBootstrap();

  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "0.0.0.0";

  const loaded = await loadModelsFile({
    envPath: process.env.MODELS_PATH,
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
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

