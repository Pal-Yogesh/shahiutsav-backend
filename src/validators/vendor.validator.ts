import { z } from "zod/v4";

export const createVendorSchema = z.object({
  businessName: z.string().min(2).max(100),
  description: z.string().max(1000).optional(),
  phone: z.string().min(10).max(15).optional(),
  whatsapp: z.string().min(10).max(15).optional(),
  address: z.string().max(500).optional(),
  cityId: z.string().min(1),
  pincode: z.string().length(6).optional(),
  gstNumber: z.string().max(15).optional(),
});

export const updateVendorSchema = createVendorSchema.partial();

export const createServiceSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  priceType: z.enum(["FIXED", "STARTING_FROM", "PER_HOUR", "PER_DAY", "PER_PLATE"]).default("FIXED"),
  price: z.number().positive(),
  priceUnit: z.string().max(50).optional(),
  images: z.array(z.string().url()).max(10).default([]),
});

export const updateServiceSchema = createServiceSchema.partial();
