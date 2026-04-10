export type ModelRequestLog = {
  ts: number;
  requestId: string;
  modelId: string;
  endpoint: string;
  status: number;
  latencyMs: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: string;
};

export class ModelRequestStore {
  private readonly buf: ModelRequestLog[];
  private count = 0;
  private readonly byId = new Map<string, ModelRequestLog>();

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("capacity must be >= 1");
    this.buf = new Array(capacity);
  }

  record(entry: ModelRequestLog) {
    const i = this.count % this.capacity;
    const prev = this.buf[i];
    if (prev) this.byId.delete(prev.requestId);

    this.buf[i] = entry;
    this.byId.set(entry.requestId, entry);
    this.count++;
  }

  /** Newest first */
  getRecent(limit: number): ModelRequestLog[] {
    const cap = this.capacity;
    const n = Math.min(limit, Math.min(this.count, cap));
    const out: ModelRequestLog[] = [];
    for (let k = 0; k < n; k++) {
      const idx = (this.count - 1 - k + cap) % cap;
      const e = this.buf[idx];
      if (e) out.push(e);
    }
    return out;
  }

  getById(requestId: string): ModelRequestLog | null {
    return this.byId.get(requestId) ?? null;
  }
};

export function modelRequestHistoryCapacityFromEnv(): number {
  const raw = process.env.MODEL_REQUEST_HISTORY_MAX?.trim();
  if (!raw) return 5000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 5000;
  return Math.min(Math.floor(n), 50_000);
}

