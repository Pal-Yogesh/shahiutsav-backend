import type { Request, Response, NextFunction } from "express";
import { auth } from "../lib/auth.js";
import { sendError } from "../helpers/api-response.js";
import { fromNodeHeaders } from "better-auth/node";

// Middleware: attach session to request if authenticated
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return sendError(res, "Unauthorized", 401);
    }

    // Attach to request for downstream use
    (req as any).session = session;
    next();
  } catch {
    return sendError(res, "Unauthorized", 401);
  }
}

// Optional auth — attaches session if present, doesn't block
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    (req as any).session = session;
  } catch {
    // no-op
  }
  next();
}

// Helper to get session from request
export function getSession(req: Request) {
  return (req as any).session as ReturnType<typeof auth.api.getSession> extends Promise<infer T> ? T : never;
}

// Gate a route to specific roles. Use after requireAuth: router.get("/", requireAuth, requireRole("admin"), …)
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getSession(req)?.user.role;
    if (!role || !roles.includes(role)) {
      return sendError(res, "You don't have access to this", 403);
    }
    next();
  };
}
