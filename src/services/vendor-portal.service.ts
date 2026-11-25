import { getDb, TX_OPTIONS } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import { escapeHtml, notifyAdmins } from "./notifications.js";
import { PRICE_UNITS } from "./vendor-application.service.js";
import { MIN_DESCRIPTION } from "../validators/vendor-application.validator.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { z } from "zod/v4";
import type {
  changeRequestSchema,
  profileUpdateSchema,
  serviceSchema,
  serviceUpdateSchema,
} from "../validators/vendor-application.validator.js";

// A live vendor's self-service: every rule about what applies instantly,
// what waits for review, and what is blocked lives in this file.

export const MAX_LIVE_SERVICES = 20;
const OPEN_BOOKING_STATUSES = ["PENDING", "ACCEPTED"] as const;

type Tx = Prisma.TransactionClient | PrismaClient;

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const PROFILE_LABELS: Record<string, string> = {
  contactName: "contact person",
  phone: "mobile number",
  whatsapp: "WhatsApp number",
  address: "address",
  pincode: "pincode",
  yearsInBusiness: "years in business",
  description: "description",
  instagram: "Instagram",
  website: "website",
  profileImage: "profile photo",
  coverImage: "cover photo",
  portfolio: "portfolio photos",
};

function logActivity(tx: Tx, entry: { vendorId: string; actorId: string | null; type: string; summary: string; details?: Prisma.InputJsonValue }) {
  return tx.vendorActivity.create({ data: entry });
}

// The vendor profile behind the signed-in user. Editing needs an approved, unsuspended listing.
async function vendorFor(userId: string, { forEdit }: { forEdit: boolean }) {
  const vendor = await getDb().vendorProfile.findUnique({
    where: { userId },
    select: { id: true, status: true, isActive: true, businessName: true, cityId: true, gstNumber: true },
  });
  if (!vendor || !["APPROVED", "SUSPENDED"].includes(vendor.status)) {
    throw new HttpError(404, "Your dashboard opens once your application is approved.");
  }
  if (forEdit && vendor.status === "SUSPENDED") {
    throw new HttpError(403, "Your listing is suspended, so changes are paused. Please contact our team.");
  }
  return vendor;
}

// ─── Dashboard ───────────────────────────────────────────────────────

function completeness(p: {
  description: string | null;
  profileImage: string | null;
  coverImage: string | null;
  portfolio: string[];
  instagram: string | null;
  website: string | null;
  whatsapp: string | null;
  gstNumber: string | null;
}, liveServices: number) {
  const items = [
    { key: "description", label: `A description of at least ${MIN_DESCRIPTION * 2} characters`, done: (p.description?.length ?? 0) >= MIN_DESCRIPTION * 2 },
    { key: "profileImage", label: "A logo or profile photo", done: !!p.profileImage },
    { key: "coverImage", label: "A cover photo", done: !!p.coverImage },
    { key: "portfolio", label: "At least 4 portfolio photos", done: p.portfolio.length >= 4 },
    { key: "social", label: "Instagram or website", done: !!(p.instagram || p.website) },
    { key: "whatsapp", label: "A WhatsApp number", done: !!p.whatsapp },
    { key: "gstNumber", label: "Your GSTIN", done: !!p.gstNumber },
    { key: "services", label: "At least 2 live services", done: liveServices >= 2 },
  ];
  return { percent: Math.round((items.filter((i) => i.done).length / items.length) * 100), items };
}

export async function getDashboard(userId: string) {
  const db = getDb();
  const { id } = await vendorFor(userId, { forEdit: false });
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));

  const [profile, services, pendingChange, lastDecidedChange, bookingCounts, upcoming, activity, notes] = await Promise.all([
    db.vendorProfile.findUniqueOrThrow({
      where: { id },
      include: { city: { select: { id: true, name: true, slug: true, state: true } } },
    }),
    db.service.findMany({
      where: { vendorId: id, archivedAt: null },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        categoryId: true,
        title: true,
        description: true,
        priceType: true,
        price: true,
        status: true,
        isActive: true,
        reviewNote: true,
        submittedAt: true,
        updatedAt: true,
        category: { select: { name: true, slug: true } },
      },
    }),
    db.vendorChangeRequest.findFirst({ where: { vendorId: id, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    db.vendorChangeRequest.findFirst({ where: { vendorId: id, status: { in: ["APPROVED", "REJECTED"] } }, orderBy: { reviewedAt: "desc" } }),
    db.bookingItem.groupBy({ by: ["status"], where: { vendorId: id }, _count: { _all: true } }),
    db.bookingItem.findMany({
      where: { vendorId: id, status: { in: [...OPEN_BOOKING_STATUSES] }, booking: { eventDate: { gte: startOfToday } } },
      orderBy: { booking: { eventDate: "asc" } },
      take: 6,
      select: {
        id: true,
        status: true,
        price: true,
        service: { select: { title: true } },
        booking: { select: { eventDate: true, eventType: true, guestCount: true, city: { select: { name: true } }, customer: { select: { name: true } } } },
      },
    }),
    db.vendorActivity.findMany({
      where: { vendorId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, type: true, summary: true, createdAt: true, actor: { select: { name: true, role: true } } },
    }),
    db.vendorStatusEvent.findMany({
      where: { vendorId: id, note: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, toStatus: true, note: true, createdAt: true },
    }),
  ]);

  const counts = Object.fromEntries(bookingCounts.map((b) => [b.status, b._count._all])) as Record<string, number>;
  const live = services.filter((s) => s.status === "LIVE");
  const liveActive = live.filter((s) => s.isActive);
  const { termsAcceptedAt: _t, userId: _u, ...rest } = profile;

  return {
    profile: rest,
    services,
    pendingChange,
    lastDecidedChange,
    upcoming,
    activity,
    notes,
    completeness: completeness(profile, live.length),
    stats: {
      liveServices: liveActive.length,
      pausedServices: live.length - liveActive.length,
      pendingServices: services.filter((s) => s.status === "PENDING").length,
      bookingRequests: counts.PENDING ?? 0,
      confirmedBookings: (counts.ACCEPTED ?? 0) + (counts.COMPLETED ?? 0),
      totalBookings: Object.values(counts).reduce((a, b) => a + b, 0),
      rating: profile.rating,
      totalReviews: profile.totalReviews,
    },
    // Why customers can or can't see the listing right now
    visibility:
      profile.status === "SUSPENDED"
        ? "suspended"
        : !profile.isActive
          ? "paused"
          : liveActive.length === 0
            ? "no_services"
            : "live",
  };
}

// ─── Profile ─────────────────────────────────────────────────────────

export async function updateProfile(userId: string, input: z.infer<typeof profileUpdateSchema>) {
  const db = getDb();
  const vendor = await vendorFor(userId, { forEdit: true });
  const current = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendor.id }, select: Object.fromEntries(Object.keys(PROFILE_LABELS).map((k) => [k, true])) });

  const changed = Object.entries(input).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify((current as Record<string, unknown>)[k]));
  if (!changed.length) return getDashboard(userId);

  const data = Object.fromEntries(changed);
  await db.$transaction(async (tx) => {
    await tx.vendorProfile.update({ where: { id: vendor.id }, data });
    await logActivity(tx, {
      vendorId: vendor.id,
      actorId: userId,
      type: "PROFILE_UPDATED",
      summary: `Updated ${changed.map(([k]) => PROFILE_LABELS[k]).join(", ")}`,
      details: { fields: changed.map(([k]) => k) },
    });
  }, TX_OPTIONS);
  return getDashboard(userId);
}

export async function requestIdentityChange(userId: string, input: z.infer<typeof changeRequestSchema>) {
  const db = getDb();
  const vendor = await vendorFor(userId, { forEdit: true });

  const changes: Record<string, string | null> = {};
  const previous: Record<string, string | null> = {};
  if (input.businessName !== undefined && input.businessName !== vendor.businessName) {
    changes.businessName = input.businessName;
    previous.businessName = vendor.businessName;
  }
  if (input.cityId !== undefined && input.cityId !== vendor.cityId) {
    const city = await db.city.findFirst({ where: { id: input.cityId, isActive: true }, select: { id: true } });
    if (!city) throw new HttpError(422, "Choose a city from the list", { cityId: "Choose a city from the list" });
    changes.cityId = input.cityId;
    previous.cityId = vendor.cityId;
  }
  if (input.gstNumber !== undefined && (input.gstNumber ?? null) !== vendor.gstNumber) {
    changes.gstNumber = input.gstNumber ?? null;
    previous.gstNumber = vendor.gstNumber;
  }
  if (!Object.keys(changes).length) throw new HttpError(422, "Nothing has changed yet");
  if (input.reason) changes.reason = input.reason;

  // One open request at a time: a new request replaces the previous one
  await db.$transaction(async (tx) => {
    await tx.vendorChangeRequest.updateMany({ where: { vendorId: vendor.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.vendorChangeRequest.create({ data: { vendorId: vendor.id, changes, previous } });
    await logActivity(tx, {
      vendorId: vendor.id,
      actorId: userId,
      type: "CHANGE_REQUESTED",
      summary: `Asked to change ${Object.keys(changes).filter((k) => k !== "reason").map((k) => ({ businessName: "business name", cityId: "city", gstNumber: "GSTIN" })[k]).join(", ")}`,
    });
  }, TX_OPTIONS);

  void notifyAdmins({
    subject: `Listing change to review: ${vendor.businessName}`,
    heading: "A vendor asked to change their details",
    body: `<p><strong>${escapeHtml(vendor.businessName)}</strong> asked to update their business name, city or GSTIN.</p>`,
    path: "/admin/updates",
  });
  return getDashboard(userId);
}

export async function cancelIdentityChange(userId: string) {
  const vendor = await vendorFor(userId, { forEdit: true });
  const { count } = await getDb().vendorChangeRequest.updateMany({ where: { vendorId: vendor.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (!count) throw new HttpError(409, "There's no pending request to cancel");
  return getDashboard(userId);
}

// ─── Listing ─────────────────────────────────────────────────────────

export async function setListingActive(userId: string, isActive: boolean) {
  const db = getDb();
  const vendor = await vendorFor(userId, { forEdit: true });
  if (vendor.isActive === isActive) return getDashboard(userId);
  await db.$transaction(async (tx) => {
    await tx.vendorProfile.update({ where: { id: vendor.id }, data: { isActive } });
    await logActivity(tx, {
      vendorId: vendor.id,
      actorId: userId,
      type: isActive ? "LISTING_RESUMED" : "LISTING_PAUSED",
      summary: isActive ? "Listing is visible to customers again" : "Paused the listing (hidden from customers)",
    });
  }, TX_OPTIONS);
  return getDashboard(userId);
}

// ─── Services ────────────────────────────────────────────────────────

export async function addService(userId: string, input: z.infer<typeof serviceSchema>) {
  const db = getDb();
  const vendor = await vendorFor(userId, { forEdit: true });

  const [category, siblings, count] = await Promise.all([
    db.serviceCategory.findFirst({ where: { id: input.categoryId, isActive: true }, select: { id: true, name: true } }),
    db.service.findMany({ where: { vendorId: vendor.id, categoryId: input.categoryId, archivedAt: null }, select: { status: true } }),
    db.service.count({ where: { vendorId: vendor.id, archivedAt: null } }),
  ]);
  if (!category) throw new HttpError(422, "Choose a category from the list", { categoryId: "Choose a category from the list" });
  if (count >= MAX_LIVE_SERVICES) throw new HttpError(422, `You can list up to ${MAX_LIVE_SERVICES} services. Remove one to add another.`);

  // Already approved for this category → live now. A new category → our team reviews it first.
  const approvedForCategory = siblings.some((s) => s.status === "LIVE");
  const status = approvedForCategory ? "LIVE" : "PENDING";

  await db.$transaction(async (tx) => {
    await tx.service.create({
      data: { ...input, vendorId: vendor.id, status, priceUnit: PRICE_UNITS[input.priceType], images: [] },
    });
    await logActivity(tx, {
      vendorId: vendor.id,
      actorId: userId,
      type: approvedForCategory ? "SERVICE_ADDED" : "CATEGORY_REQUESTED",
      summary: approvedForCategory
        ? `Added "${input.title}" at ${inr(input.price)}`
        : `Applied to offer ${category.name} with "${input.title}"`,
    });
  }, TX_OPTIONS);

  if (!approvedForCategory) {
    void notifyAdmins({
      subject: `New category to review: ${vendor.businessName} → ${category.name}`,
      heading: "A vendor wants to offer a new category",
      body: `<p><strong>${escapeHtml(vendor.businessName)}</strong> applied to offer <strong>${escapeHtml(category.name)}</strong> with “${escapeHtml(input.title)}”.</p>`,
      path: "/admin/updates",
    });
  }
  return getDashboard(userId);
}

export async function updateService(userId: string, serviceId: string, input: z.infer<typeof serviceUpdateSchema>) {
  const db = getDb();
  const vendor = await vendorFor(userId, { forEdit: true });
  const service = await db.service.findFirst({
    where: { id: serviceId, vendorId: vendor.id, archivedAt: null },
    select: { id: true, title: true, description: true, price: true, priceType: true, status: true, isActive: true, category: { select: { name: true } } },
  });
  if (!service) throw new HttpError(404, "Service not found");

  const priceChanged = input.price !== undefined && input.price !== service.price;
  const detailsChanged =
    (input.title !== undefined && input.title !== service.title) ||
    (input.description !== undefined && (input.description ?? null) !== service.description) ||
    (input.priceType !== undefined && input.priceType !== service.priceType);
  const contentChanged = priceChanged || detailsChanged;
  const toggled = input.isActive !== undefined && input.isActive !== service.isActive;
  if (!contentChanged && !toggled) return getDashboard(userId);

  // Editing a declined category sends it back for review
  const resubmit = contentChanged && service.status === "REJECTED";
  const title = input.title ?? service.title;
  const entries: { type: string; summary: string }[] = [];
  if (priceChanged) {
    entries.push({ type: "PRICE_CHANGED", summary: `Changed "${title}" price from ${inr(service.price)} to ${inr(input.price!)}` });
  }
  if (detailsChanged || resubmit) {
    entries.push({ type: "SERVICE_UPDATED", summary: resubmit ? `Updated "${title}" and sent ${service.category.name} for review again` : `Updated "${title}"` });
  }
  if (toggled) {
    entries.push({ type: input.isActive ? "SERVICE_RESUMED" : "SERVICE_PAUSED", summary: `${input.isActive ? "Resumed" : "Paused"} "${title}"` });
  }

  await db.$transaction(async (tx) => {
    await tx.service.update({
      where: { id: service.id },
      data: {
        ...input,
        ...(input.priceType ? { priceUnit: PRICE_UNITS[input.priceType] } : {}),
        ...(resubmit ? { status: "PENDING", reviewNote: null, submittedAt: new Date() } : {}),
      },
    });
    for (const e of entries) await logActivity(tx, { vendorId: vendor.id, actorId: userId, ...e });
  }, TX_OPTIONS);

  if (resubmit) {
    void notifyAdmins({
      subject: `Category resubmitted: ${vendor.businessName} → ${service.category.name}`,
      heading: "A vendor updated a declined service",
      body: `<p><strong>${escapeHtml(vendor.businessName)}</strong> updated “${escapeHtml(title)}” (${escapeHtml(service.category.name)}) and asked for another review.</p>`,
      path: "/admin/updates",
    });
  }
  return getDashboard(userId);
}

export async function removeService(userId: string, serviceId: string) {
  const db = getDb();
  const vendor = await vendorFor(userId, { forEdit: true });
  const service = await db.service.findFirst({ where: { id: serviceId, vendorId: vendor.id, archivedAt: null }, select: { id: true, title: true } });
  if (!service) throw new HttpError(404, "Service not found");

  // Customers who already booked this service keep it until their event
  const open = await db.bookingItem.count({
    where: { serviceId, status: { in: [...OPEN_BOOKING_STATUSES] }, booking: { eventDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } },
  });
  if (open) {
    throw new HttpError(409, `"${service.title}" has ${open} upcoming booking${open > 1 ? "s" : ""}. Pause it instead to stop new bookings.`);
  }

  await db.$transaction(async (tx) => {
    // Kept (archived) rather than deleted so past bookings still show what was booked
    await tx.service.update({ where: { id: service.id }, data: { archivedAt: new Date(), isActive: false } });
    await logActivity(tx, { vendorId: vendor.id, actorId: userId, type: "SERVICE_REMOVED", summary: `Removed "${service.title}"` });
  }, TX_OPTIONS);
  return getDashboard(userId);
}

export { logActivity };
