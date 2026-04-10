export type RangeKey = "15m" | "1h" | "24h";

export function rangeLabel(r: RangeKey) {
  return r === "15m" ? "15m" : r === "1h" ? "1h" : "24h";
}

export function fmtTs(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

