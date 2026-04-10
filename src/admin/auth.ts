import type { FastifyReply, FastifyRequest } from "fastify";

/** True when the server accepts remote connections (not loopback-only). */
export function shouldEnforceLocalhostGuard(bindHost: string): boolean {
  const h = bindHost.trim().toLowerCase();
  if (h === "127.0.0.1" || h === "::1" || h === "localhost") return false;
  return true;
}

export function isLocalhostRequest(req: FastifyRequest): boolean {
  const raw =
    (req.socket as import("node:net").Socket)?.remoteAddress ??
    (req as any).ip ??
    "";
  return isLocalhostAddress(String(raw));
}

export function isLocalhostAddress(addr: string): boolean {
  if (!addr) return false;
  if (addr === "127.0.0.1" || addr === "::1") return true;
  if (addr.startsWith("::ffff:")) {
    const v4 = addr.slice("::ffff:".length);
    return v4 === "127.0.0.1";
  }
  return false;
}

export function sendForbiddenNonLocal(reply: FastifyReply) {
  return reply.code(403).send({
    error: {
      message:
        "Admin and UI are only available from localhost when the server accepts remote connections.",
    },
  });
}
