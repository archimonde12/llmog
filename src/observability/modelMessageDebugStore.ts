export type MessageDebugRole = "system" | "user";

export type MessageDebugEvent = {
  id: string;
  ts: number;
  modelId: string;
  requestId: string;
  endpoint: string;
  role: MessageDebugRole;
  rawMessageJson: unknown;
};

class Ring<T> {
  private readonly buf: T[];
  private count = 0;
  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("capacity must be >= 1");
    this.buf = new Array(capacity);
  }
  push(item: T) {
    const i = this.count % this.capacity;
    this.buf[i] = item;
    this.count++;
  }
  /** Newest first */
  list(limit: number): T[] {
    const cap = this.capacity;
    const n = Math.min(limit, Math.min(this.count, cap));
    const out: T[] = [];
    for (let k = 0; k < n; k++) {
      const idx = (this.count - 1 - k + cap) % cap;
      const e = this.buf[idx];
      if (e) out.push(e);
    }
    return out;
  }
}

export class ModelMessageDebugStore {
  private readonly byModel = new Map<string, Ring<MessageDebugEvent>>();

  constructor(private readonly perModelCapacity: number) {
    if (perModelCapacity < 1) throw new Error("perModelCapacity must be >= 1");
  }

  record(ev: MessageDebugEvent) {
    let ring = this.byModel.get(ev.modelId);
    if (!ring) {
      ring = new Ring<MessageDebugEvent>(this.perModelCapacity);
      this.byModel.set(ev.modelId, ring);
    }
    ring.push(ev);
  }

  /** Newest first */
  getRecent(modelId: string, limit: number, roles?: MessageDebugRole[]): MessageDebugEvent[] {
    const ring = this.byModel.get(modelId);
    if (!ring) return [];
    const items = ring.list(limit * 3);
    if (!roles || roles.length === 0) return items.slice(0, limit);
    const allowed = new Set(roles);
    const out: MessageDebugEvent[] = [];
    for (const it of items) {
      if (!allowed.has(it.role)) continue;
      out.push(it);
      if (out.length >= limit) break;
    }
    return out;
  }
}

