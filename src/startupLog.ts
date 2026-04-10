/** Colored startup / listen logs (ANSI when stdout is a TTY). */

const tty = process.stdout.isTTY;

function ansi(open: string, text: string): string {
  return tty ? `${open}${text}\x1b[0m` : text;
}

const color = {
  dim: (s: string) => ansi("\x1b[2m", s),
  bold: (s: string) => ansi("\x1b[1m", s),
  cyan: (s: string) => ansi("\x1b[36m", s),
  brightCyan: (s: string) => ansi("\x1b[96m", s),
  green: (s: string) => ansi("\x1b[32m", s),
  brightGreen: (s: string) => ansi("\x1b[92m", s),
  yellow: (s: string) => ansi("\x1b[33m", s),
  magenta: (s: string) => ansi("\x1b[35m", s),
  gray: (s: string) => ansi("\x1b[90m", s),
  /** label + value combined */
  labelValue: (label: string, value: string) =>
    `${color.gray(label)}  ${color.brightCyan(value)}`,
};

export type StartupPreambleOpts = {
  nodeVersion: string;
  nodeEnv: string;
  host: string;
  port: number;
  modelsPath: string;
  modelsSourceKind: string;
  /** Shown when a starter models.json was auto-created on first start. */
  createdDefaultModelsFile?: boolean;
};

export function logStartupPreamble(opts: StartupPreambleOpts): void {
  const w = 56;
  const inner = w - 4;
  const border = (s: string) => color.cyan(s);
  const top = border(`╔${"═".repeat(w - 2)}╗`);
  const mid = border(`║${" ".repeat(w - 2)}║`);
  const bot = border(`╚${"═".repeat(w - 2)}╝`);
  const name = "llmog";
  const titleLine =
    border("║") +
    "  " +
    color.bold(color.brightCyan(name)) +
    " ".repeat(Math.max(0, inner - 2 - name.length)) +
    "  " +
    border("║");

  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(top);
  // eslint-disable-next-line no-console
  console.log(mid);
  // eslint-disable-next-line no-console
  console.log(titleLine);
  // eslint-disable-next-line no-console
  console.log(mid);
  // eslint-disable-next-line no-console
  console.log(bot);
  // eslint-disable-next-line no-console
  console.log("");

  const rows: [string, string][] = [
    ["Node.js", opts.nodeVersion],
    ["Environment", opts.nodeEnv],
    ["Bind", `${opts.host}:${opts.port}`],
    ["models.json", `${opts.modelsPath} (${opts.modelsSourceKind})`],
  ];
  const labelW = Math.max(...rows.map(([k]) => k.length), 11);
  for (const [k, v] of rows) {
    // eslint-disable-next-line no-console
    console.log(`  ${color.labelValue(k.padEnd(labelW), v)}`);
  }
  if (opts.createdDefaultModelsFile) {
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log(
      `  ${color.yellow("Note:")} ${color.dim("No models.json was found — wrote a starter file with an example Ollama model.")}`,
    );
    // eslint-disable-next-line no-console
    console.log(`  ${color.dim(`Edit: ${opts.modelsPath}`)}`);
  }
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(
    color.dim(
      "  Endpoints: /healthz  /readyz  /metrics  /v1/models  /v1/chat/completions  /admin/*  /ui/",
    ),
  );
  // eslint-disable-next-line no-console
  console.log("");
}

export type ListenBannerOpts = {
  /** Fastify listen() result, e.g. http://0.0.0.0:8787 */
  address: string;
  port: number;
};

export function logListenBanner(opts: ListenBannerOpts): void {
  const localUrl = `http://127.0.0.1:${opts.port}`;
  const sep = color.dim("─".repeat(58));

  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log(
    `  ${color.bold(color.brightGreen("Listening"))}  ${color.brightCyan(opts.address)}`,
  );
  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`  ${color.bold(color.yellow("Local"))}`);
  // eslint-disable-next-line no-console
  console.log(`    ${color.brightCyan(localUrl)}`);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`  ${color.bold(color.magenta("Public HTTPS tunnel"))}`);
  // eslint-disable-next-line no-console
  console.log(
    color.dim(
      "  Run one of these in another terminal to expose this server:",
    ),
  );
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`  ${color.gray("ngrok")}`);
  // eslint-disable-next-line no-console
  console.log(`    ${color.green(`ngrok http ${opts.port}`)}`);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`  ${color.gray("Cloudflare Tunnel (cloudflared)")}`);
  // eslint-disable-next-line no-console
  console.log(`    ${color.green(`cloudflared tunnel --url ${localUrl}`)}`);
  // eslint-disable-next-line no-console
  console.log(
    color.dim(
      "    Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/",
    ),
  );
  // eslint-disable-next-line no-console
  console.log("");
}
