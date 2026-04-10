// Explanation of this code:

import type { ModelConfig } from "../types";

/**
 * This function merges outbound headers for upstream model API calls.
 *
 * - The input is a config object with: apiKey (an optional token string),
 *   apiKeyHeader (the header name to use for the key, if custom), and headers (an object of additional custom headers).
 * - If apiKey is present:
 *    + If apiKeyHeader is unset, or is "authorization" (case-insensitive), it sets the "Authorization" header as "Bearer <apiKey>".
 *    + Otherwise, it sets a header with the name specified in apiKeyHeader (lowercased), with its value exactly apiKey (no "Bearer" prefix).
 * - Then, any additional key-value pairs from config.headers (if present) are merged in, overwriting previous values for the same key.
 * - Returns the merged headers object, or undefined if there are no headers to send.
 */
export function mergeModelOutboundHeaders(
  cfg: Pick<ModelConfig, "apiKey" | "apiKeyHeader" | "headers">,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};

  // Handle apiKey (if present) and determine the authentication header to add
  const key = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
  if (key) {
    const rawName = typeof cfg.apiKeyHeader === "string" ? cfg.apiKeyHeader.trim() : "";
    if (!rawName || /^authorization$/i.test(rawName)) {
      out.authorization = `Bearer ${key}`;
    } else {
      out[rawName.toLowerCase()] = key;
    }
  }

  // Merge in any custom headers from config.headers (if present)
  const merged = { ...out, ...(cfg.headers ?? {}) };
  // If any headers are set, return the object; otherwise, return undefined
  return Object.keys(merged).length > 0 ? merged : undefined;
}
