import { Router } from "express";
import { getActiveCities } from "../services/city.service.js";
import { sendSuccess, sendError } from "../helpers/api-response.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const cities = await getActiveCities();
    return sendSuccess(res, cities);
  } catch {
    return sendError(res, "Failed to fetch cities", 500);
  }
});

export default router;
