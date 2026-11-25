import { Router } from "express";
import { requireAuth, getSession } from "../middleware/auth.middleware.js";
import { sendSuccess } from "../helpers/api-response.js";
import { parseInput } from "../helpers/http-error.js";
import { bookingListSchema, cancelSchema, createBookingSchema, reviewSchema } from "../validators/booking.validator.js";
import {
  cancelItems,
  createBooking,
  getCustomerBooking,
  listCustomerBookings,
  listOpenEvents,
  reviewItem,
} from "../services/booking.service.js";

// The signed-in customer's bookings
const router = Router();
router.use(requireAuth);
const uid = (req: Parameters<typeof getSession>[0]) => getSession(req)!.user.id;

// GET /api/bookings?scope=upcoming|past|cancelled
router.get("/", async (req, res) => {
  const { scope } = parseInput(bookingListSchema, req.query, "Invalid filter");
  sendSuccess(res, await listCustomerBookings(uid(req), scope));
});

// GET /api/bookings/open-events → events that can take more vendors
router.get("/open-events", async (req, res) => {
  sendSuccess(res, await listOpenEvents(uid(req)));
});

router.get("/:id", async (req, res) => {
  sendSuccess(res, await getCustomerBooking(uid(req), req.params.id));
});

// POST /api/bookings → request services (new event, or { bookingId } to add to one)
router.post("/", async (req, res) => {
  sendSuccess(res, await createBooking(uid(req), parseInput(createBookingSchema, req.body)), undefined, 201);
});

// Cancel the whole booking, or one vendor's part of it
router.post("/:id/cancel", async (req, res) => {
  const { reason } = parseInput(cancelSchema, req.body ?? {});
  sendSuccess(res, await cancelItems(uid(req), req.params.id, null, reason));
});
router.post("/:id/items/:itemId/cancel", async (req, res) => {
  const { reason } = parseInput(cancelSchema, req.body ?? {});
  sendSuccess(res, await cancelItems(uid(req), req.params.id, req.params.itemId, reason));
});

router.post("/:id/items/:itemId/review", async (req, res) => {
  sendSuccess(res, await reviewItem(uid(req), req.params.id, req.params.itemId, parseInput(reviewSchema, req.body)), undefined, 201);
});

export default router;
