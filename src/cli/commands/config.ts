import { Command } from "commander";
import path from "node:path";
import { loadModelsFileFromPath, formatConfigError } from "../../config/load";

type ValidateOptions = {
  file?: string;
};

export function configCommand() {
  const cmd = new Command("config");
  cmd.description("Configuration utilities.");

  cmd
    .command("validate")
    .description("Validate models.json schema.")
    .option("--file <path>", "Config file path (default: ./models.json)")
    .action(async (opts: ValidateOptions) => {
      const filePath = path.resolve(opts.file ?? path.resolve(process.cwd(), "models.json"));
      try {
        await loadModelsFileFromPath(filePath);
        // eslint-disable-next-line no-console
        console.log(`OK: ${filePath}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(formatConfigError(err));
        process.exitCode = 1;
      }
    });

  return cmd;
}

