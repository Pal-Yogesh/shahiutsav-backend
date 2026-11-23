import { Router } from "express";
import { getActiveCategories } from "../services/category.service.js";
import { sendSuccess, sendError } from "../helpers/api-response.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const categories = await getActiveCategories();
    return sendSuccess(res, categories);
  } catch {
    return sendError(res, "Failed to fetch categories", 500);
  }
});

export default router;
