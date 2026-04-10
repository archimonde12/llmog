import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";

export function genRequestId(req: { headers: Record<string, any> }) {
  const hdr =
    req.headers["x-request-id"] ??
    req.headers["X-Request-Id"] ??
    req.headers["x-request-id".toLowerCase()];
  if (typeof hdr === "string" && hdr.trim()) return hdr.trim();
  return crypto.randomUUID();
}

export async function registerRequestId(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
}

