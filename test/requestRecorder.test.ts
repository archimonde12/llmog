import { describe, expect, test } from "vitest";
import { RequestRecorder } from "../src/observability/requestRecorder";

function entry(id: string, ts: number) {
  return {
    requestId: id,
    ts,
    method: "GET",
    path: "/x",
    status: 200,
    durationMs: 1,
  };
}

describe("RequestRecorder", () => {
  test("returns newest first and respects capacity", () => {
    const r = new RequestRecorder(3);
    r.record(entry("a", 1));
    r.record(entry("b", 2));
    r.record(entry("c", 3));
    r.record(entry("d", 4));
    const recent = r.getRecent(10);
    expect(recent.map((x) => x.requestId)).toEqual(["d", "c", "b"]);
  });
});
