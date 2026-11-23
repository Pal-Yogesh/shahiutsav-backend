import { Router } from "express";
import { requireAuth, getSession } from "../middleware/auth.middleware.js";
import { sendSuccess } from "../helpers/api-response.js";
import { parseInput } from "../helpers/http-error.js";
import { applicationDraftSchema } from "../validators/vendor-application.validator.js";
import { getMyApplication, saveDraft, submitApplication } from "../services/vendor-application.service.js";

// The signed-in user's own vendor application
const router = Router();
router.use(requireAuth);

// GET /api/vendor-application → the application, or null if not started
router.get("/", async (req, res) => {
  sendSuccess(res, await getMyApplication(getSession(req)!.user.id));
});

// PUT /api/vendor-application → create or update the draft (any subset of fields)
router.put("/", async (req, res) => {
  const input = parseInput(applicationDraftSchema, req.body);
  sendSuccess(res, await saveDraft(getSession(req)!.user.id, input));
});

// POST /api/vendor-application/submit → send for review
router.post("/submit", async (req, res) => {
  sendSuccess(res, await submitApplication(getSession(req)!.user.id));
});

export default router;
