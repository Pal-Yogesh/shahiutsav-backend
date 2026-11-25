import { z } from "zod/v4";
import { EVENT_TYPES } from "../config/index.js";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const normalisePhone = (v: string) => v.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");

const itemSchema = z.object({
  serviceId: z.string().min(1),
  notes: z.string().trim().max(500).optional(),
});

// New booking, or more services for an event the customer already has (bookingId)
export const createBookingSchema = z
  .object({
    bookingId: z.string().min(1).optional(),
    eventDate: z.string().regex(DATE_KEY, "Choose a date").optional(),
    eventType: z.enum(EVENT_TYPES, { error: "Choose the occasion" }).optional(),
    guestCount: z.coerce.number().int().min(1, "At least 1 guest").max(100_000).nullish(),
    venue: z.string().trim().max(300).nullish(),
    cityId: z.string().min(1).optional(),
    contactPhone: z
      .string()
      .transform(normalisePhone)
      .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a 10-digit mobile number")
      .optional(),
    notes: z.string().trim().max(2000).nullish(),
    items: z.array(itemSchema).min(1, "Choose at least one service").max(10),
  })
  .superRefine((v, ctx) => {
    // A new event needs its details; adding to an existing one reuses them
    if (v.bookingId) return;
    if (!v.eventDate) ctx.addIssue({ code: "custom", path: ["eventDate"], message: "Choose the event date" });
    if (!v.eventType) ctx.addIssue({ code: "custom", path: ["eventType"], message: "Choose the occasion" });
    if (!v.cityId) ctx.addIssue({ code: "custom", path: ["cityId"], message: "Choose the city" });
    if (!v.contactPhone) ctx.addIssue({ code: "custom", path: ["contactPhone"], message: "Add a number the vendor can call" });
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingListSchema = z.object({
  scope: z.enum(["upcoming", "past", "cancelled"]).default("upcoming"),
});

export const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5),
  comment: z.string().trim().max(1500).optional(),
});

// ─── Vendor responses ────────────────────────────────────────────────

export const vendorBookingListSchema = z.object({
  view: z.enum(["requests", "upcoming", "completion", "history"]).default("requests"),
});

export const acceptSchema = z.object({
  // Confirm a different final amount, e.g. after discussing a "starting from" package
  price: z.coerce.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const declineSchema = z.object({
  reason: z.string().trim().min(3, "Tell the customer why").max(500),
});

export const vendorCancelSchema = z.object({
  reason: z.string().trim().min(3, "Tell the customer why").max(500),
});
