import { Command } from "commander";

type StatusOptions = {
  url?: string;
};

export function statusCommand() {
  const cmd = new Command("status");
  cmd
    .description("Check server health (GET /healthz).")
    .option("--url <baseUrl>", "Base URL of llm-proxy (default: http://127.0.0.1:8787)")
    .action(async (opts: StatusOptions) => {
      const baseUrl = (opts.url ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
      const res = await fetch(`${baseUrl}/healthz`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const body = await res.text();
      // eslint-disable-next-line no-console
      console.log(`status=${res.status} url=${baseUrl}/healthz`);
      // eslint-disable-next-line no-console
      console.log(body);
    });

  return cmd;
}

