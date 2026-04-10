#!/usr/bin/env node
import "dotenv/config";
import { runCli } from "./index.js";

runCli().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

