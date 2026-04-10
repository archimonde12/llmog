#!/usr/bin/env node
import { loadDotenvForBootstrap, parseModelsFlagFromArgv } from "../config/dotenvBootstrap";
import { runCli } from "./index.js";

loadDotenvForBootstrap({ cliFlagPath: parseModelsFlagFromArgv(process.argv) })
  .then(() => runCli())
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });

