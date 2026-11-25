import { getDb, TX_OPTIONS } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import { LIVE_SERVICE } from "./listing-rules.js";
import { escapeHtml, notifyVendor } from "./notifications.js";
import {
  ACTIVE_ITEM,
  BOOKING_WINDOW_DAYS,
  addDays,
  dateKey,
  eventDateFromKey,
  inr,
  isBeforeEvent,
  logBookingEvent,
  syncBooking,
  todayKey,
} from "./booking-rules.js";
import type { CreateBookingInput } from "../validators/booking.validator.js";
import type { Prisma } from "../generated/prisma/client.js";

// The customer's side of bookings: request, follow, cancel and review.

const cityFields = { id: true, name: true, slug: true, state: true } as const;

// ─── Create ──────────────────────────────────────────────────────────

export async function createBooking(customerId: string, input: CreateBookingInput) {
  const db = getDb();
  const serviceIds = [...new Set(input.items.map((i) => i.serviceId))];

  // Bookable = live service of an approved, active vendor. Vendor and price come from the
  // database, never from the request.
  const services = await db.service.findMany({
    where: { id: { in: serviceIds }, ...LIVE_SERVICE, vendor: { status: "APPROVED", isActive: true } },
    select: { id: true, title: true, price: true, vendorId: true, vendor: { select: { userId: true, businessName: true, user: { select: { email: true } } } } },
  });
  if (services.length !== serviceIds.length) {
    throw new HttpError(422, "Some of these services are no longer available. Please refresh and choose again.");
  }
  if (services.some((s) => s.vendor.userId === customerId)) {
    throw new HttpError(422, "You can't book your own services.");
  }

  // Existing event, or a new one
  let booking: { id: string; eventDate: Date; eventType: string } | null = null;
  if (input.bookingId) {
    booking = await db.booking.findFirst({
      where: { id: input.bookingId, customerId, status: { in: ["PENDING", "CONFIRMED"] } },
      select: { id: true, eventDate: true, eventType: true },
    });
    if (!booking || !isBeforeEvent(booking.eventDate) || dateKey(booking.eventDate) === todayKey()) {
      throw new HttpError(422, "That event can't take new services any more. Start a new booking instead.");
    }
    const already = await db.bookingItem.findMany({
      where: { bookingId: booking.id, serviceId: { in: serviceIds }, status: { in: ["PENDING", "ACCEPTED"] } },
      select: { service: { select: { title: true } } },
    });
    if (already.length) throw new HttpError(409, `"${already[0].service.title}" is already part of this event.`);
  } else {
    const today = todayKey();
    if (input.eventDate! <= today) throw new HttpError(422, "Choose a date from tomorrow onwards", { eventDate: "Choose a date from tomorrow onwards" });
    if (input.eventDate! > addDays(today, BOOKING_WINDOW_DAYS)) throw new HttpError(422, "Bookings open up to two years ahead", { eventDate: "Choose a date within the next two years" });
    const city = await db.city.findFirst({ where: { id: input.cityId, isActive: true }, select: { id: true } });
    if (!city) throw new HttpError(422, "Choose a city from the list", { cityId: "Choose a city from the list" });
  }

  const byId = new Map(services.map((s) => [s.id, s]));
  const notesFor = new Map(input.items.map((i) => [i.serviceId, i.notes || null]));

  const bookingId = await db.$transaction(async (tx) => {
    const id =
      booking?.id ??
      (
        await tx.booking.create({
          data: {
            customerId,
            eventDate: eventDateFromKey(input.eventDate!),
            eventType: input.eventType!,
            guestCount: input.guestCount ?? null,
            venue: input.venue || null,
            cityId: input.cityId!,
            contactPhone: input.contactPhone!,
            notes: input.notes || null,
          },
          select: { id: true },
        })
      ).id;

    for (const serviceId of serviceIds) {
      const s = byId.get(serviceId)!;
      const item = await tx.bookingItem.create({
        data: { bookingId: id, vendorId: s.vendorId, serviceId, price: s.price, listedPrice: s.price, notes: notesFor.get(serviceId) },
        select: { id: true },
      });
      await logBookingEvent(tx, { bookingId: id, itemId: item.id, actorId: customerId, type: "REQUESTED", message: `Requested ${s.title} from ${s.vendor.businessName}` });
    }
    await syncBooking(tx, id);
    return id;
  }, TX_OPTIONS);

  // Tell each vendor once, listing their services in this request
  const created = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { eventDate: true, eventType: true, city: { select: { name: true } } } });
  const byVendor = new Map<string, typeof services>();
  for (const s of services) byVendor.set(s.vendorId, [...(byVendor.get(s.vendorId) ?? []), s]);
  for (const list of byVendor.values()) {
    notifyVendor({
      to: list[0].vendor.user.email,
      subject: `New booking request: ${created.eventType} on ${formatDay(created.eventDate)}`,
      heading: "You have a new booking request",
      body: `<p>A customer would like to book <strong>${list.map((s) => escapeHtml(s.title)).join(", ")}</strong> for a ${escapeHtml(created.eventType.toLowerCase())} in ${escapeHtml(created.city.name)} on <strong>${formatDay(created.eventDate)}</strong>.</p><p>Reply quickly: customers usually book the vendors who answer first.</p>`,
      cta: { label: "Respond to request", path: "/vendor/dashboard?tab=bookings" },
    });
  }

  return getCustomerBooking(customerId, bookingId);
}

export function formatDay(d: Date) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

// ─── Read ────────────────────────────────────────────────────────────

const itemSelect = {
  id: true,
  status: true,
  price: true,
  listedPrice: true,
  notes: true,
  vendorNote: true,
  declineReason: true,
  cancelReason: true,
  cancelledBy: true,
  respondedAt: true,
  createdAt: true,
  service: { select: { id: true, title: true, priceType: true, category: { select: { name: true, slug: true } } } },
  vendor: { select: { id: true, businessName: true, slug: true, profileImage: true, phone: true, whatsapp: true, city: { select: { name: true } } } },
} satisfies Prisma.BookingItemSelect;

type ItemRow = Prisma.BookingItemGetPayload<{ select: typeof itemSelect }>;

// Vendor numbers are shown to the customer once that vendor has accepted
function customerItem(i: ItemRow, eventDate: Date, reviewed: Set<string>) {
  const { phone, whatsapp, ...vendor } = i.vendor;
  const confirmed = i.status === "ACCEPTED" || i.status === "COMPLETED";
  return {
    ...i,
    vendor: { ...vendor, contact: confirmed ? { phone, whatsapp } : null },
    canCancel: (i.status === "PENDING" || i.status === "ACCEPTED") && isBeforeEvent(eventDate),
    canReview: i.status === "COMPLETED" && !reviewed.has(i.vendor.id),
    expired: i.status === "PENDING" && !isBeforeEvent(eventDate),
  };
}

export async function listCustomerBookings(customerId: string, scope: "upcoming" | "past" | "cancelled") {
  const db = getDb();
  const today = eventDateFromKey(todayKey());
  const where: Prisma.BookingWhereInput =
    scope === "cancelled"
      ? { customerId, status: "CANCELLED" }
      : scope === "upcoming"
        ? { customerId, status: { not: "CANCELLED" }, eventDate: { gte: today } }
        : { customerId, status: { not: "CANCELLED" }, eventDate: { lt: today } };

  const [rows, counts] = await Promise.all([
    db.booking.findMany({
      where,
      orderBy: { eventDate: scope === "upcoming" ? "asc" : "desc" },
      take: 50,
      select: {
        id: true,
        eventDate: true,
        eventType: true,
        guestCount: true,
        venue: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        city: { select: cityFields },
        items: { orderBy: { createdAt: "asc" }, select: itemSelect },
      },
    }),
    Promise.all([
      db.booking.count({ where: { customerId, status: { not: "CANCELLED" }, eventDate: { gte: today } } }),
      db.booking.count({ where: { customerId, status: { not: "CANCELLED" }, eventDate: { lt: today } } }),
      db.booking.count({ where: { customerId, status: "CANCELLED" } }),
    ]),
  ]);
  const reviews = await reviewedVendors(customerId, rows.map((r) => r.id));

  return {
    bookings: rows.map((b) => {
      const seen = new Set<string>();
      return {
        ...b,
        items: b.items.map((i) => {
          const item = customerItem(i, b.eventDate, reviews.get(b.id) ?? new Set());
          const first = i.status === "COMPLETED" && !seen.has(i.vendor.id);
          if (first) seen.add(i.vendor.id);
          return { ...item, canReview: item.canReview && first };
        }),
      };
    }),
    counts: { upcoming: counts[0], past: counts[1], cancelled: counts[2] },
  };
}

async function reviewedVendors(customerId: string, bookingIds: string[]) {
  const rows = await getDb().review.findMany({ where: { customerId, bookingId: { in: bookingIds } }, select: { bookingId: true, vendorId: true } });
  const map = new Map<string, Set<string>>();
  for (const r of rows) map.set(r.bookingId!, (map.get(r.bookingId!) ?? new Set()).add(r.vendorId));
  return map;
}

export async function getCustomerBooking(customerId: string, bookingId: string) {
  const db = getDb();
  const b = await db.booking.findFirst({
    where: { id: bookingId, customerId },
    select: {
      id: true,
      eventDate: true,
      eventType: true,
      guestCount: true,
      venue: true,
      notes: true,
      contactPhone: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      city: { select: cityFields },
      items: { orderBy: { createdAt: "asc" }, select: itemSelect },
      events: { orderBy: { createdAt: "desc" }, select: { id: true, type: true, message: true, createdAt: true } },
    },
  });
  if (!b) throw new HttpError(404, "Booking not found");
  const reviews = await db.review.findMany({ where: { customerId, bookingId }, select: { vendorId: true, rating: true, comment: true, createdAt: true } });
  const reviewed = new Set(reviews.map((r) => r.vendorId));
  // A review is per vendor per event: show it (or the form) on that vendor's first completed service only
  const firstCompleted = new Map<string, string>();
  for (const i of b.items) if (i.status === "COMPLETED" && !firstCompleted.has(i.vendor.id)) firstCompleted.set(i.vendor.id, i.id);
  return {
    ...b,
    items: b.items.map((i) => {
      const owner = firstCompleted.get(i.vendor.id) === i.id;
      const item = customerItem(i, b.eventDate, reviewed);
      return { ...item, canReview: item.canReview && owner, review: owner ? (reviews.find((r) => r.vendorId === i.vendor.id) ?? null) : null };
    }),
    // More vendors can join the event until the day before
    canAddServices: (b.status === "PENDING" || b.status === "CONFIRMED") && dateKey(b.eventDate) > todayKey(),
  };
}

// Events a customer can add more vendors to, for the "add to an existing event" option
export async function listOpenEvents(customerId: string) {
  const tomorrow = eventDateFromKey(addDays(todayKey(), 1));
  return getDb().booking.findMany({
    where: { customerId, status: { in: ["PENDING", "CONFIRMED"] }, eventDate: { gte: tomorrow } },
    orderBy: { eventDate: "asc" },
    take: 10,
    select: { id: true, eventDate: true, eventType: true, city: { select: { name: true } }, _count: { select: { items: { where: { status: { in: ACTIVE_ITEM } } } } } },
  });
}

// ─── Cancel ──────────────────────────────────────────────────────────

export async function cancelItems(customerId: string, bookingId: string, itemId: string | null, reason?: string) {
  const db = getDb();
  const booking = await db.booking.findFirst({ where: { id: bookingId, customerId }, select: { id: true, eventDate: true, eventType: true } });
  if (!booking) throw new HttpError(404, "Booking not found");
  if (!isBeforeEvent(booking.eventDate)) throw new HttpError(409, "This event has already taken place, so it can't be cancelled.");

  const targets = await db.bookingItem.findMany({
    where: { bookingId, ...(itemId ? { id: itemId } : {}), status: { in: ["PENDING", "ACCEPTED"] } },
    select: { id: true, status: true, service: { select: { title: true } }, vendor: { select: { businessName: true, user: { select: { email: true } } } } },
  });
  if (!targets.length) throw new HttpError(409, itemId ? "This service can't be cancelled any more." : "There's nothing left to cancel.");

  await db.$transaction(async (tx) => {
    for (const t of targets) {
      const { count } = await tx.bookingItem.updateMany({
        where: { id: t.id, status: { in: ["PENDING", "ACCEPTED"] } },
        data: { status: "CANCELLED", cancelledBy: "customer", cancelReason: reason || null, cancelledAt: new Date() },
      });
      if (!count) throw new HttpError(409, "This booking was just updated. Refresh and try again.");
      await logBookingEvent(tx, { bookingId, itemId: t.id, actorId: customerId, type: "CANCELLED", message: `You cancelled ${t.service.title} with ${t.vendor.businessName}` });
    }
    await syncBooking(tx, bookingId);
  }, TX_OPTIONS);

  for (const t of targets) {
    notifyVendor({
      to: t.vendor.user.email,
      subject: `Booking cancelled: ${booking.eventType} on ${formatDay(booking.eventDate)}`,
      heading: t.status === "ACCEPTED" ? "A confirmed booking was cancelled" : "A booking request was withdrawn",
      body: `<p>The customer cancelled <strong>${escapeHtml(t.service.title)}</strong> for ${formatDay(booking.eventDate)}.</p>`,
      note: reason,
      cta: { label: "Open bookings", path: "/vendor/dashboard?tab=bookings" },
    });
  }
  return getCustomerBooking(customerId, bookingId);
}

// ─── Review ──────────────────────────────────────────────────────────

export async function reviewItem(customerId: string, bookingId: string, itemId: string, input: { rating: number; comment?: string }) {
  const db = getDb();
  const item = await db.bookingItem.findFirst({
    where: { id: itemId, bookingId, booking: { customerId } },
    select: { status: true, vendorId: true, vendor: { select: { businessName: true } } },
  });
  if (!item) throw new HttpError(404, "Booking not found");
  if (item.status !== "COMPLETED") throw new HttpError(409, "You can review a vendor once they've marked the booking complete.");

  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.review.findFirst({ where: { customerId, vendorId: item.vendorId, bookingId }, select: { id: true } });
      if (existing) throw new HttpError(409, "You've already reviewed this vendor for this event.");
      await tx.review.create({ data: { customerId, vendorId: item.vendorId, bookingId, rating: input.rating, comment: input.comment || null } });
      // Recalculate from all reviews so the average can't drift
      const agg = await tx.review.aggregate({ where: { vendorId: item.vendorId }, _avg: { rating: true }, _count: { _all: true } });
      await tx.vendorProfile.update({
        where: { id: item.vendorId },
        data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, totalReviews: agg._count._all },
      });
      await logBookingEvent(tx, { bookingId, itemId, actorId: customerId, type: "REVIEWED", message: `You rated ${item.vendor.businessName} ${input.rating}/5` });
    }, TX_OPTIONS);
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "You've already reviewed this vendor for this event.");
    throw err;
  }
  return getCustomerBooking(customerId, bookingId);
}

export { inr };
