import { z } from "zod/v4";

export const createBookingSchema = z.object({
  eventDate: z.coerce.date().refine((d) => d > new Date(), {
    message: "Event date must be in the future",
  }),
  eventType: z.string().min(1).max(100),
  guestCount: z.number().int().positive().optional(),
  venue: z.string().max(500).optional(),
  cityId: z.string().min(1),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        vendorId: z.string().min(1),
        serviceId: z.string().min(1),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1),
});
