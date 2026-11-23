import { z } from "zod/v4";
import { PAGINATION } from "../config/index.js";

export const searchParamsSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_LIMIT)
    .default(PAGINATION.DEFAULT_LIMIT),
  sort: z
    .enum(["relevance", "price_asc", "price_desc", "rating", "reviews"])
    .default("relevance"),
});

export type SearchParamsInput = z.infer<typeof searchParamsSchema>;
