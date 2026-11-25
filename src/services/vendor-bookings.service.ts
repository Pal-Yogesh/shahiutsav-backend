import { getDb, TX_OPTIONS } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import { escapeHtml, notifyVendor as sendEmail } from "./notifications.js";
import { ITEM_RULES, dateKey, eventDateFromKey, inr, isBeforeEvent, isEventOver, logBookingEvent, syncBooking, todayKey } from "./booking-rules.js";
import { formatDay } from "./booking.service.js";
import type { Prisma } from "../generated/prisma/client.js";

// The vendor's side of bookings: answer requests and see them through to the event.

type View = "requests" | "upcoming" | "completion" | "history";

async function vendorOf(userId: string) {
  const v = await getDb().vendorProfile.findUnique({ where: { userId }, select: { id: true, status: true, businessName: true } });
  if (!v || !["APPROVED", "SUSPENDED"].includes(v.status)) throw new HttpError(404, "Your dashboard opens once your application is approved.");
  return v;
}

function whereFor(vendorId: string, view: View): Prisma.BookingItemWhereInput {
  const today = eventDateFromKey(todayKey());
  switch (view) {
    case "requests":
      return { vendorId, status: "PENDING", booking: { eventDate: { gte: today } } };
    case "upcoming":
      return { vendorId, status: "ACCEPTED", booking: { eventDate: { gte: today } } };
    case "completion": // the event has passed: confirm it happened
      return { vendorId, status: "ACCEPTED", booking: { eventDate: { lt: today } } };
    case "history":
      return {
        vendorId,
        OR: [{ status: { in: ["COMPLETED", "REJECTED", "CANCELLED"] } }, { status: "PENDING", booking: { eventDate: { lt: today } } }],
      };
  }
}

const select = {
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
  completedAt: true,
  createdAt: true,
  service: { select: { id: true, title: true, priceType: true, category: { select: { name: true } } } },
  booking: {
    select: {
      id: true,
      eventDate: true,
      eventType: true,
      guestCount: true,
      venue: true,
      notes: true,
      contactPhone: true,
      city: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      _count: { select: { items: { where: { status: { in: ["PENDING", "ACCEPTED", "COMPLETED"] } } } } },
    },
  },
} satisfies Prisma.BookingItemSelect;

type Row = Prisma.BookingItemGetPayload<{ select: typeof select }>;

// Customer contact details are shared only once the vendor has accepted
function toVendorItem(r: Row) {
  const { contactPhone, customer, _count, ...booking } = r.booking;
  const confirmed = r.status === "ACCEPTED" || r.status === "COMPLETED";
  return {
    ...r,
    booking: {
      ...booking,
      customer: { name: customer.name, ...(confirmed ? { email: customer.email, phone: contactPhone } : {}) },
      otherServices: Math.max(0, _count.items - 1),
    },
    canAccept: r.status === "PENDING" && isBeforeEvent(r.booking.eventDate),
    canDecline: r.status === "PENDING",
    canComplete: r.status === "ACCEPTED" && isEventOver(r.booking.eventDate),
    canCancel: r.status === "ACCEPTED" && isBeforeEvent(r.booking.eventDate),
    expired: r.status === "PENDING" && !isBeforeEvent(r.booking.eventDate),
  };
}

export async function listVendorBookings(userId: string, view: View) {
  const db = getDb();
  const vendor = await vendorOf(userId);
  const views: View[] = ["requests", "upcoming", "completion", "history"];
  const [rows, ...counts] = await Promise.all([
    db.bookingItem.findMany({
      where: whereFor(vendor.id, view),
      orderBy: view === "history" ? { updatedAt: "desc" } : { booking: { eventDate: "asc" } },
      take: 60,
      select,
    }),
    ...views.map((v) => db.bookingItem.count({ where: whereFor(vendor.id, v) })),
  ]);
  return { items: rows.map(toVendorItem), counts: Object.fromEntries(views.map((v, i) => [v, counts[i]])) as Record<View, number> };
}

type Action = "accept" | "decline" | "complete" | "vendorCancel";

// One guarded update for every vendor action: checks ownership, status and date,
// applies the change only if nobody else changed the item first, then logs and emails.
async function act(userId: string, itemId: string, action: Action, data: { price?: number; note?: string; reason?: string }) {
  const db = getDb();
  const vendor = await vendorOf(userId);
  const rule = ITEM_RULES[action];

  const item = await db.bookingItem.findFirst({
    where: { id: itemId, vendorId: vendor.id },
    select: { status: true, price: true, bookingId: true, service: { select: { title: true } }, booking: { select: { eventDate: true, eventType: true, customerId: true, customer: { select: { email: true } } } } },
  });
  if (!item) throw new HttpError(404, "Booking not found");
  if (!(rule.from as readonly string[]).includes(item.status)) throw new HttpError(409, "This booking was already updated. Refresh to see the latest.");

  const { eventDate } = item.booking;
  if (action === "accept") {
    if (vendor.status === "SUSPENDED") throw new HttpError(403, "Your listing is suspended, so you can't accept new bookings right now.");
    if (!isBeforeEvent(eventDate)) throw new HttpError(409, "This event date has passed, so the request can't be accepted.");
  }
  if (action === "complete" && !isEventOver(eventDate)) throw new HttpError(409, "You can mark this complete on or after the event day.");
  if (action === "vendorCancel" && !isBeforeEvent(eventDate)) throw new HttpError(409, "This event has already taken place.");

  const now = new Date();
  const finalPrice = action === "accept" && data.price !== undefined ? data.price : item.price;
  const update: Prisma.BookingItemUpdateManyMutationInput =
    action === "accept"
      ? { status: "ACCEPTED", price: finalPrice, vendorNote: data.note || null, respondedAt: now }
      : action === "decline"
        ? { status: "REJECTED", declineReason: data.reason, respondedAt: now }
        : action === "complete"
          ? { status: "COMPLETED", completedAt: now }
          : { status: "CANCELLED", cancelledBy: "vendor", cancelReason: data.reason, cancelledAt: now };

  const message = {
    accept: `${vendor.businessName} confirmed ${item.service.title}${finalPrice !== item.price ? ` at ${inr(finalPrice)}` : ""}`,
    decline: `${vendor.businessName} declined ${item.service.title}`,
    complete: `${vendor.businessName} marked ${item.service.title} as completed`,
    vendorCancel: `${vendor.businessName} cancelled ${item.service.title}`,
  }[action];

  await db.$transaction(async (tx) => {
    const { count } = await tx.bookingItem.updateMany({ where: { id: itemId, status: { in: [...rule.from] } }, data: update });
    if (!count) throw new HttpError(409, "This booking was already updated. Refresh to see the latest.");
    if (action === "complete") await tx.vendorProfile.update({ where: { id: vendor.id }, data: { totalBookings: { increment: 1 } } });
    await logBookingEvent(tx, { bookingId: item.bookingId, itemId, actorId: userId, type: { accept: "ACCEPTED", decline: "DECLINED", complete: "COMPLETED", vendorCancel: "CANCELLED" }[action], message });
    await syncBooking(tx, item.bookingId);
  }, TX_OPTIONS);

  const day = formatDay(eventDate);
  const svc = escapeHtml(item.service.title);
  const biz = escapeHtml(vendor.businessName);
  const email = {
    accept: {
      subject: `Confirmed: ${vendor.businessName} for ${day}`,
      heading: "Your booking is confirmed",
      body: `<p><strong>${biz}</strong> confirmed <strong>${svc}</strong> for your ${escapeHtml(item.booking.eventType.toLowerCase())} on ${day}${finalPrice !== item.price ? `, at <strong>${inr(finalPrice)}</strong>` : ""}. Their contact details are now in your booking.</p>`,
      note: data.note,
    },
    decline: {
      subject: `${vendor.businessName} can't take your booking`,
      heading: "This vendor isn't available",
      body: `<p><strong>${biz}</strong> can't do <strong>${svc}</strong> on ${day}. Other vendors in your city may be free. Your other bookings are unaffected.</p>`,
      note: data.reason,
    },
    complete: {
      subject: `How was ${vendor.businessName}?`,
      heading: "We hope it was a wonderful event",
      body: `<p><strong>${biz}</strong> marked <strong>${svc}</strong> as completed. A quick review helps other families choose well.</p>`,
      note: null,
    },
    vendorCancel: {
      subject: `${vendor.businessName} cancelled your booking`,
      heading: "A vendor cancelled",
      body: `<p><strong>${biz}</strong> had to cancel <strong>${svc}</strong> for ${day}. We're sorry. You can book another vendor for the same event from your dashboard.</p>`,
      note: data.reason,
    },
  }[action];
  sendEmail({ to: item.booking.customer.email, ...email, cta: { label: action === "complete" ? "Leave a review" : "View booking", path: `/dashboard/bookings/${item.bookingId}` } });

  const fresh = await db.bookingItem.findUniqueOrThrow({ where: { id: itemId }, select });
  return toVendorItem(fresh);
}

export const acceptItem = (u: string, id: string, d: { price?: number; note?: string }) => act(u, id, "accept", d);
export const declineItem = (u: string, id: string, reason: string) => act(u, id, "decline", { reason });
export const completeItem = (u: string, id: string) => act(u, id, "complete", {});
export const cancelItemAsVendor = (u: string, id: string, reason: string) => act(u, id, "vendorCancel", { reason });

export { dateKey };
