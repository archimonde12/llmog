export type RecordedRequest = {
  requestId: string;
  ts: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  modelId?: string;
  adapter?: string;
  error?: string;
};

export class RequestRecorder {
  private readonly buf: RecordedRequest[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("capacity must be >= 1");
    this.buf = new Array(capacity);
  }

  record(entry: RecordedRequest) {
    const i = this.count % this.capacity;
    this.buf[i] = entry;
    this.count++;
    if (this.count <= this.capacity) this.head = 0;
    else this.head = this.count % this.capacity;
  }

  /** Newest first */
  getRecent(limit: number): RecordedRequest[] {
    const cap = this.capacity;
    const n = Math.min(limit, Math.min(this.count, cap));
    const out: RecordedRequest[] = [];
    for (let k = 0; k < n; k++) {
      const idx = (this.count - 1 - k + cap) % cap;
      const e = this.buf[idx];
      if (e) out.push(e);
    }
    return out;
  }
}

export function requestHistoryCapacityFromEnv(): number {
  const raw = process.env.REQUEST_HISTORY_MAX?.trim();
  if (!raw) return 200;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 200;
  return Math.min(Math.floor(n), 10_000);
}
