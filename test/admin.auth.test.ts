import { describe, expect, test } from "vitest";
import {
  isLocalhostAddress,
  shouldEnforceLocalhostGuard,
} from "../src/admin/auth";

describe("admin auth", () => {
  test("shouldEnforceLocalhostGuard", () => {
    expect(shouldEnforceLocalhostGuard("127.0.0.1")).toBe(false);
    expect(shouldEnforceLocalhostGuard("::1")).toBe(false);
    expect(shouldEnforceLocalhostGuard("localhost")).toBe(false);
    expect(shouldEnforceLocalhostGuard("0.0.0.0")).toBe(true);
    expect(shouldEnforceLocalhostGuard("::")).toBe(true);
  });

  test("isLocalhostAddress", () => {
    expect(isLocalhostAddress("127.0.0.1")).toBe(true);
    expect(isLocalhostAddress("::1")).toBe(true);
    expect(isLocalhostAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLocalhostAddress("10.0.0.1")).toBe(false);
  });
});
