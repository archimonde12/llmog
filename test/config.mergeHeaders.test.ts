import { describe, expect, test } from "vitest";
import { mergeModelOutboundHeaders } from "../src/config/mergeHeaders";

describe("mergeModelOutboundHeaders", () => {
  test("apiKey only → Authorization Bearer", () => {
    expect(mergeModelOutboundHeaders({ apiKey: "secret" })).toEqual({
      authorization: "Bearer secret",
    });
  });

  test("apiKey + apiKeyHeader x-api-key → raw header value", () => {
    expect(
      mergeModelOutboundHeaders({
        apiKey: "k",
        apiKeyHeader: "x-api-key",
      }),
    ).toEqual({ "x-api-key": "k" });
  });

  test("apiKey + apiKeyHeader Authorization → Bearer", () => {
    expect(
      mergeModelOutboundHeaders({
        apiKey: "t",
        apiKeyHeader: "Authorization",
      }),
    ).toEqual({ authorization: "Bearer t" });
  });

  test("headers override same key as apiKey auth", () => {
    expect(
      mergeModelOutboundHeaders({
        apiKey: "secret",
        headers: { authorization: "Bearer override" },
      }),
    ).toEqual({ authorization: "Bearer override" });
  });

  test("merges extra headers", () => {
    expect(
      mergeModelOutboundHeaders({
        apiKey: "x",
        headers: { "x-custom": "y" },
      }),
    ).toEqual({
      authorization: "Bearer x",
      "x-custom": "y",
    });
  });

  test("only explicit headers when no apiKey", () => {
    expect(
      mergeModelOutboundHeaders({
        headers: { "x-custom": "y" },
      }),
    ).toEqual({ "x-custom": "y" });
  });

  test("empty apiKey whitespace-only is ignored", () => {
    expect(mergeModelOutboundHeaders({ apiKey: "   " })).toBeUndefined();
  });
});
