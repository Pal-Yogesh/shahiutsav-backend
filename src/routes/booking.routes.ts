import { Router } from "express";
import { createBooking, getBookingsByCustomer } from "../services/booking.service.js";
import { createBookingSchema } from "../validators/booking.validator.js";
import { searchParamsSchema } from "../validators/search.validator.js";
import { sendSuccess, sendError, paginationMeta } from "../helpers/api-response.js";
import { requireAuth, getSession } from "../middleware/auth.middleware.js";
import { HttpError } from "../helpers/http-error.js";

const router = Router();

// GET /api/bookings — list customer bookings (auth required)
router.get("/", requireAuth, async (req, res) => {
  try {
    const session = getSession(req);
    const parsed = searchParamsSchema.safeParse({
      page: req.query.page,
      limit: req.query.limit,
    });
    if (!parsed.success) {
      return sendError(res, "Invalid parameters");
    }

    const { data, total } = await getBookingsByCustomer(
      session!.user.id,
      parsed.data.page,
      parsed.data.limit
    );
    const meta = paginationMeta(parsed.data.page, parsed.data.limit, total);

    return sendSuccess(res, data, meta);
  } catch {
    return sendError(res, "Failed to fetch bookings", 500);
  }
});

// POST /api/bookings — create booking (auth required)
router.post("/", requireAuth, async (req, res) => {
  try {
    const session = getSession(req);
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Invalid booking data");
    }

    const booking = await createBooking({
      customerId: session!.user.id,
      ...parsed.data,
    });

    return sendSuccess(res, booking, undefined, 201);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.message, err.status);
    return sendError(res, "Failed to create booking", 500);
  }
});

export default router;
