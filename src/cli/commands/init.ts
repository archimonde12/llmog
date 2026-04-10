import { Command } from "commander";
import prompts from "prompts";
import fs from "node:fs/promises";
import path from "node:path";
import { createDefaultModelsFile } from "../../config/defaultModelsFile";
import { defaultUserModelsPath, ensureParentDir } from "../../config/paths";

type InitOptions = {
  file?: string;
  yes?: boolean;
};

function defaultModelsTemplate(args: { includeOpenAICompatible: boolean }) {
  const file = createDefaultModelsFile();
  if (args.includeOpenAICompatible) {
    file.models.push({
      id: "openai-compatible",
      adapter: "openai_compatible",
      baseUrl: "http://localhost:8000",
      model: "your-model-name",
    } as (typeof file.models)[number]);
  }
  return file;
}

export function initCommand() {
  const cmd = new Command("init");
  cmd
    .description("Create a starter models.json config (wizard if interactive).")
    .option("--file <path>", "Where to write the config")
    .option("-y, --yes", "Non-interactive (use defaults)", false)
    .action(async (opts: InitOptions) => {
      const isInteractive = Boolean(process.stdin.isTTY && !opts.yes);

      const targetPath = path.resolve(opts.file ?? defaultUserModelsPath());

      let includeOpenAICompatible = true;
      if (isInteractive) {
        const answers = await prompts(
          [
            {
              type: "confirm",
              name: "includeOpenAICompatible",
              message: "Include an OpenAI-compatible upstream example?",
              initial: true,
            },
          ],
          {
            onCancel: () => {
              process.exitCode = 1;
              throw new Error("Cancelled");
            },
          },
        );
        includeOpenAICompatible = Boolean(answers.includeOpenAICompatible);
      }

      const content = JSON.stringify(
        defaultModelsTemplate({ includeOpenAICompatible }),
        null,
        2,
      );

      await ensureParentDir(targetPath);
      await fs.writeFile(targetPath, content + "\n", { encoding: "utf8", flag: "wx" }).catch(
        async (err: any) => {
          if (err?.code === "EEXIST") {
            throw new Error(`Refusing to overwrite existing file: ${targetPath}`);
          }
          throw err;
        },
      );

      // eslint-disable-next-line no-console
      console.log(`Wrote config to ${targetPath}`);
      // eslint-disable-next-line no-console
      console.log(`Next: llmog start --models "${targetPath}"`);
    });

  return cmd;
}

