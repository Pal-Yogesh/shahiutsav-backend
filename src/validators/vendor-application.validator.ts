import { z } from "zod/v4";

// Indian formats. Phones are stored as 10 digits, without +91.
export const PHONE_RE = /^[6-9]\d{9}$/;
export const PINCODE_RE = /^[1-9]\d{5}$/;
export const GST_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

export const MAX_SERVICES = 10;
export const MAX_PORTFOLIO = 12;
export const MIN_DESCRIPTION = 60;

// Form fields arrive as strings; "" means "cleared", stored as null
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullish();
}

function optionalFormatted(re: RegExp, message: string, normalise: (v: string) => string = (v) => v) {
  return z
    .string()
    .transform((v) => normalise(v.trim()))
    .refine((v) => v === "" || re.test(v), message)
    .transform((v) => (v === "" ? null : v))
    .nullish();
}

const normalisePhone = (v: string) => v.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");

const httpsUrl = z
  .string()
  .trim()
  .url("Enter a full link starting with https://")
  .refine((v) => v.startsWith("https://"), "Use a secure link (https://)")
  .max(500);

export const serviceSchema = z.object({
  categoryId: z.string().min(1, "Choose a category"),
  title: z.string().trim().min(3, "Give this service a name").max(120),
  description: optionalText(600),
  priceType: z.enum(["FIXED", "STARTING_FROM", "PER_HOUR", "PER_DAY", "PER_PLATE"]).default("STARTING_FROM"),
  price: z.coerce
    .number({ error: "Enter a price" })
    .int("Use whole rupees")
    .min(100, "Price should be at least ₹100")
    .max(10_000_000, "That price looks too high"),
});

// Saving a draft: every field optional, but anything present must be well formed
export const applicationDraftSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(100).optional(),
  cityId: z.string().min(1, "Choose your city").optional(),
  contactName: optionalText(80),
  phone: optionalFormatted(PHONE_RE, "Enter a 10-digit mobile number", normalisePhone),
  whatsapp: optionalFormatted(PHONE_RE, "Enter a 10-digit WhatsApp number", normalisePhone),
  address: optionalText(300),
  pincode: optionalFormatted(PINCODE_RE, "Enter a 6-digit pincode"),
  yearsInBusiness: z.coerce.number().int().min(0).max(100).nullish(),
  description: optionalText(1500),
  instagram: optionalFormatted(HANDLE_RE, "Enter your Instagram handle, like shahi.events", (v) =>
    v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "")
  ),
  website: z.union([z.literal("").transform(() => null), httpsUrl]).nullish(),
  gstNumber: optionalFormatted(GST_RE, "That doesn't look like a valid GSTIN", (v) => v.toUpperCase()),
  profileImage: z.union([z.literal("").transform(() => null), httpsUrl]).nullish(),
  coverImage: z.union([z.literal("").transform(() => null), httpsUrl]).nullish(),
  portfolio: z.array(httpsUrl).max(MAX_PORTFOLIO, `Add up to ${MAX_PORTFOLIO} photos`).optional(),
  services: z.array(serviceSchema).max(MAX_SERVICES, `Add up to ${MAX_SERVICES} services`).optional(),
  termsAccepted: z.boolean().optional(),
});

export type ApplicationDraftInput = z.infer<typeof applicationDraftSchema>;

export const adminDecisionSchema = z.object({
  action: z.enum(["approve", "request_changes", "reject", "suspend", "reinstate", "reopen"]),
  note: z.string().trim().max(2000).optional(),
});

export const adminListSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── Vendor dashboard (live listings) ────────────────────────────────

// Applied instantly: day-to-day details customers see
export const profileUpdateSchema = applicationDraftSchema
  .pick({
    contactName: true,
    phone: true,
    whatsapp: true,
    address: true,
    pincode: true,
    yearsInBusiness: true,
    description: true,
    instagram: true,
    website: true,
    profileImage: true,
    coverImage: true,
    portfolio: true,
  })
  .strict();

// Applied after admin review: identity fields
export const changeRequestSchema = z
  .object({
    businessName: z.string().trim().min(2, "Enter your business name").max(100).optional(),
    cityId: z.string().min(1).optional(),
    gstNumber: applicationDraftSchema.shape.gstNumber,
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

// Written out (not serviceSchema.partial()) so priceType's default can't overwrite it on a price-only update
export const serviceUpdateSchema = z
  .object({
    title: serviceSchema.shape.title.optional(),
    description: serviceSchema.shape.description,
    priceType: z.enum(["FIXED", "STARTING_FROM", "PER_HOUR", "PER_DAY", "PER_PLATE"]).optional(),
    price: serviceSchema.shape.price.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const listingSchema = z.object({ isActive: z.boolean() }).strict();

export const reviewDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional(),
});
