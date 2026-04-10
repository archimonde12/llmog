export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as any;
      msg = j?.error?.message ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function apiJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as any;
      msg = j?.error?.message ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}

