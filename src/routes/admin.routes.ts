import { Router } from "express";
import { requireAuth, requireRole, getSession } from "../middleware/auth.middleware.js";
import { sendSuccess, paginationMeta } from "../helpers/api-response.js";
import { parseInput } from "../helpers/http-error.js";
import { adminDecisionSchema, adminListSchema, reviewDecisionSchema } from "../validators/vendor-application.validator.js";
import { countPendingUpdates, decideChangeRequest, decideService, listPendingUpdates } from "../services/admin-updates.service.js";
import { decide, getApplication, getStatusCounts, listApplications } from "../services/admin-vendor.service.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

// GET /api/admin/vendors/summary → number of applications in each status
router.get("/vendors/summary", async (_req, res) => {
  sendSuccess(res, await getStatusCounts());
});

// GET /api/admin/vendors?status=SUBMITTED&q=&page= → review queue
router.get("/vendors", async (req, res) => {
  const params = parseInput(adminListSchema, req.query, "Invalid filters");
  const { data, total } = await listApplications(params);
  sendSuccess(res, data, paginationMeta(params.page, params.limit, total));
});

// GET /api/admin/vendors/:id → full application with history
router.get("/vendors/:id", async (req, res) => {
  sendSuccess(res, await getApplication(req.params.id));
});

// POST /api/admin/vendors/:id/decision { action, note } → approve, request changes, reject…
router.post("/vendors/:id/decision", async (req, res) => {
  const { action, note } = parseInput(adminDecisionSchema, req.body);
  sendSuccess(res, await decide({ id: req.params.id, action, note, adminId: getSession(req)!.user.id }));
});

// ─── Updates to live listings ────────────────────────────────────────

// GET /api/admin/updates/count → for the nav badge
router.get("/updates/count", async (_req, res) => {
  sendSuccess(res, await countPendingUpdates());
});

// GET /api/admin/updates → new categories and business-detail changes waiting for review
router.get("/updates", async (_req, res) => {
  sendSuccess(res, await listPendingUpdates());
});

router.post("/services/:id/decision", async (req, res) => {
  const { action, note } = parseInput(reviewDecisionSchema, req.body);
  await decideService({ id: req.params.id, action, note, adminId: getSession(req)!.user.id });
  sendSuccess(res, await listPendingUpdates());
});

router.post("/change-requests/:id/decision", async (req, res) => {
  const { action, note } = parseInput(reviewDecisionSchema, req.body);
  await decideChangeRequest({ id: req.params.id, action, note, adminId: getSession(req)!.user.id });
  sendSuccess(res, await listPendingUpdates());
});

export default router;
