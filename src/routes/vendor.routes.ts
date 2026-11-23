import { Router } from "express";
import { searchVendors, getVendorBySlug, getFeaturedVendors } from "../services/vendor.service.js";
import { searchParamsSchema } from "../validators/search.validator.js";
import { sendSuccess, sendError, paginationMeta } from "../helpers/api-response.js";

const router = Router();

// GET /api/vendors — search vendors
router.get("/", async (req, res) => {
  try {
    const parsed = searchParamsSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, "Invalid search parameters");
    }

    const { data, total } = await searchVendors(parsed.data);
    const meta = paginationMeta(parsed.data.page, parsed.data.limit, total);

    return sendSuccess(res, data, meta);
  } catch {
    return sendError(res, "Failed to search vendors", 500);
  }
});

// GET /api/vendors/featured — top vendors for homepage
router.get("/featured", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 8;
    const vendors = await getFeaturedVendors(Math.min(limit, 20));
    return sendSuccess(res, vendors);
  } catch {
    return sendError(res, "Failed to fetch featured vendors", 500);
  }
});

// GET /api/vendors/:slug — vendor detail
router.get("/:slug", async (req, res) => {
  try {
    const vendor = await getVendorBySlug(req.params.slug);
    if (!vendor) {
      return sendError(res, "Vendor not found", 404);
    }
    return sendSuccess(res, vendor);
  } catch {
    return sendError(res, "Failed to fetch vendor", 500);
  }
});

// Vendors join through /api/vendor-application and go live only after admin approval.

export default router;
