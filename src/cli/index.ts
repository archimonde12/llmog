import { Command } from "commander";
import { initCommand } from "./commands/init";
import { startCommand } from "./commands/start";
import { statusCommand } from "./commands/status";
import { doctorCommand } from "./commands/doctor";
import { configCommand } from "./commands/config";

export async function runCli(argv = process.argv) {
  const program = new Command();

  program
    .name("llmog")
    .description("A lightweight proxy to route requests to local LLMs via an OpenAI-compatible API.")
    .version(process.env.npm_package_version ?? "0.0.0");

  program.addCommand(initCommand());
  program.addCommand(startCommand());
  program.addCommand(statusCommand());
  program.addCommand(doctorCommand());
  program.addCommand(configCommand());

  await program.parseAsync(argv);
}

