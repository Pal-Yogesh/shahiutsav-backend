import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod/v4";
import { sendError } from "./api-response.js";

// Throw from any route or service; the error handler turns it into a JSON response
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>
  ) {
    super(message);
  }
}

// Validates input and throws a 422 listing each bad field as "path.to.field": "message"
export function parseInput<T>(schema: ZodType<T>, input: unknown, message = "Please check the highlighted fields"): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fieldErrors[key] ??= issue.message;
  }
  throw new HttpError(422, message, fieldErrors);
}

// Last middleware in the chain. Express 5 forwards rejected async handlers here.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return sendError(res, err.message, err.status, err.fieldErrors);
  }
  // Malformed JSON body or one over the size limit
  const status = (err as { status?: number })?.status;
  if (status === 400 || status === 413) {
    return sendError(res, status === 413 ? "Request is too large" : "Invalid request body", status);
  }
  console.error("[api] Unhandled error:", err);
  return sendError(res, "Something went wrong on our side. Please try again.", 500);
}
