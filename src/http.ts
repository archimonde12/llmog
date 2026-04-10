/**
 * Join `base` (origin and optional path prefix) with `path`.
 * `new URL("/v1/...", base)` drops any path on `base` because a leading `/` is
 * origin-absolute; this helper preserves prefixes like `/api`.
 */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

export type HttpJsonResponse<T> = {
  status: number;
  headers: Headers;
  json: T;
};

export type HttpStreamResponse = {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
};

export async function postJson<T>(
  url: string,
  body: unknown,
  opts?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<HttpJsonResponse<T>> {
  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 1800_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts?.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = (await res.json()) as T;
    return { status: res.status, headers: res.headers, json };
  } finally {
    clearTimeout(timer);
  }
}

// Like postJson, but returns the raw streaming body. Timeout applies only to the
// initial request (until headers are received), not the entire stream duration.
export async function postJsonStream(
  url: string,
  body: unknown,
  opts?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<HttpStreamResponse> {
  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 1800_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts?.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status !== 200) {
      const {messages,tools,...rest} = body as any;
      const safeHeaders =
        opts?.headers && typeof opts.headers === "object"
          ? Object.fromEntries(
              Object.entries(opts.headers).map(([k, v]) => [
                k,
                /^authorization$/i.test(k) ? "<redacted>" : v,
              ]),
            )
          : undefined;
      console.log("postJsonStream", JSON.stringify(rest), JSON.stringify(safeHeaders));
      console.log("postJsonStream res", res);
    }
   

    return { status: res.status, headers: res.headers, body: res.body };
  } finally {
    clearTimeout(timer);
  }
}

