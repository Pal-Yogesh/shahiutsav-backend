import { Router } from "express";
import { requireAuth, getSession } from "../middleware/auth.middleware.js";
import { sendSuccess } from "../helpers/api-response.js";
import { parseInput } from "../helpers/http-error.js";
import {
  changeRequestSchema,
  listingSchema,
  profileUpdateSchema,
  serviceSchema,
  serviceUpdateSchema,
} from "../validators/vendor-application.validator.js";
import {
  addService,
  cancelIdentityChange,
  getDashboard,
  removeService,
  requestIdentityChange,
  setListingActive,
  updateProfile,
  updateService,
} from "../services/vendor-portal.service.js";
import { acceptSchema, declineSchema, vendorBookingListSchema, vendorCancelSchema } from "../validators/booking.validator.js";
import { acceptItem, cancelItemAsVendor, completeItem, declineItem, listVendorBookings } from "../services/vendor-bookings.service.js";

// A live vendor managing their own listing. Every write returns the refreshed dashboard.
const router = Router();
router.use(requireAuth);
const uid = (req: Parameters<typeof getSession>[0]) => getSession(req)!.user.id;

router.get("/dashboard", async (req, res) => {
  sendSuccess(res, await getDashboard(uid(req)));
});

// Instant edits: contact details, description, photos, links
router.patch("/profile", async (req, res) => {
  sendSuccess(res, await updateProfile(uid(req), parseInput(profileUpdateSchema, req.body)));
});

// Reviewed edits: business name, city, GSTIN
router.post("/profile/change-request", async (req, res) => {
  sendSuccess(res, await requestIdentityChange(uid(req), parseInput(changeRequestSchema, req.body)), undefined, 201);
});
router.delete("/profile/change-request", async (req, res) => {
  sendSuccess(res, await cancelIdentityChange(uid(req)));
});

// Pause or resume the whole listing
router.patch("/listing", async (req, res) => {
  sendSuccess(res, await setListingActive(uid(req), parseInput(listingSchema, req.body).isActive));
});

router.post("/services", async (req, res) => {
  sendSuccess(res, await addService(uid(req), parseInput(serviceSchema, req.body)), undefined, 201);
});
router.patch("/services/:id", async (req, res) => {
  sendSuccess(res, await updateService(uid(req), req.params.id, parseInput(serviceUpdateSchema, req.body)));
});
router.delete("/services/:id", async (req, res) => {
  sendSuccess(res, await removeService(uid(req), req.params.id));
});

// ─── Bookings ────────────────────────────────────────────────────────

// GET /api/vendor-portal/bookings?view=requests|upcoming|completion|history
router.get("/bookings", async (req, res) => {
  const { view } = parseInput(vendorBookingListSchema, req.query, "Invalid view");
  sendSuccess(res, await listVendorBookings(uid(req), view));
});
router.post("/bookings/:itemId/accept", async (req, res) => {
  sendSuccess(res, await acceptItem(uid(req), req.params.itemId, parseInput(acceptSchema, req.body ?? {})));
});
router.post("/bookings/:itemId/decline", async (req, res) => {
  sendSuccess(res, await declineItem(uid(req), req.params.itemId, parseInput(declineSchema, req.body).reason));
});
router.post("/bookings/:itemId/complete", async (req, res) => {
  sendSuccess(res, await completeItem(uid(req), req.params.itemId));
});
router.post("/bookings/:itemId/cancel", async (req, res) => {
  sendSuccess(res, await cancelItemAsVendor(uid(req), req.params.itemId, parseInput(vendorCancelSchema, req.body).reason));
});

export default router;
