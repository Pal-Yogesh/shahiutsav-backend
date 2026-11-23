import type { Response } from "express";
import type { ApiResponse, PaginationMeta } from "../types/index.js";

export function sendSuccess<T>(res: Response, data: T, meta?: PaginationMeta, status = 200) {
  const body: ApiResponse<T> = { success: true, data, meta };
  return res.status(status).json(body);
}

export function sendError(res: Response, error: string, status = 400, fieldErrors?: Record<string, string>) {
  const body: ApiResponse = { success: false, error, ...(fieldErrors ? { fieldErrors } : {}) };
  return res.status(status).json(body);
}

export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
