/**
 * Browser client for OpenAI-style SSE from POST /v1/chat/completions (stream: true).
 */

export type StreamChatOptions = {
  signal?: AbortSignal;
  onDelta: (text: string) => void;
};

function extractDeltaContent(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const any = parsed as Record<string, unknown>;
  if (any.error && typeof any.error === "object") {
    const msg = (any.error as { message?: string }).message;
    throw new Error(typeof msg === "string" && msg.length ? msg : "Stream error");
  }
  const choices = any.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const delta = (choices[0] as { delta?: { content?: unknown } }).delta;
  const content = delta?.content;
  return typeof content === "string" ? content : "";
}

export async function streamChatCompletions(
  path: string,
  body: Record<string, unknown>,
  opts: StreamChatOptions,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      msg = j?.error?.message ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  if (!res.body) {
    throw new Error("Empty response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep < 0) break;
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const lines = rawEvent.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trimStart();
          if (payload === "[DONE]") {
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const text = extractDeltaContent(parsed);
          if (text.length) {
            opts.onDelta(text);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
