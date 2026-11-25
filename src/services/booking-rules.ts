import type { BookingItemStatus, BookingStatus, Prisma } from "../generated/prisma/client.js";

// ─── Dates ───────────────────────────────────────────────────────────
// Events are whole days. They are stored at 12:00 UTC so the calendar date is the same
// everywhere, and "today" is judged in Indian time.

export function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); // YYYY-MM-DD
}

export function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function eventDateFromKey(key: string) {
  return new Date(`${key}T12:00:00.000Z`);
}

export function addDays(key: string, days: number) {
  const d = eventDateFromKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKey(d);
}

// Bookings can be requested from tomorrow up to two years ahead
export const BOOKING_WINDOW_DAYS = 730;

export const isBeforeEvent = (eventDate: Date) => dateKey(eventDate) >= todayKey(); // event day still counts
export const isEventOver = (eventDate: Date) => dateKey(eventDate) <= todayKey(); // can complete on or after the day

// ─── Item transitions ────────────────────────────────────────────────

export const ACTIVE_ITEM: BookingItemStatus[] = ["PENDING", "ACCEPTED", "COMPLETED"];

export const ITEM_RULES = {
  accept: { from: ["PENDING"], to: "ACCEPTED", by: "vendor" },
  decline: { from: ["PENDING"], to: "REJECTED", by: "vendor" },
  complete: { from: ["ACCEPTED"], to: "COMPLETED", by: "vendor" },
  vendorCancel: { from: ["ACCEPTED"], to: "CANCELLED", by: "vendor" },
  customerCancel: { from: ["PENDING", "ACCEPTED"], to: "CANCELLED", by: "customer" },
} as const satisfies Record<string, { from: BookingItemStatus[]; to: BookingItemStatus; by: "vendor" | "customer" }>;

// ─── Booking status ──────────────────────────────────────────────────

export function deriveBookingStatus(items: { status: BookingItemStatus }[]): BookingStatus {
  const active = items.filter((i) => ACTIVE_ITEM.includes(i.status));
  if (active.length === 0) return "CANCELLED";
  if (active.every((i) => i.status === "COMPLETED")) return "COMPLETED";
  if (active.some((i) => i.status === "ACCEPTED" || i.status === "COMPLETED")) return "CONFIRMED";
  return "PENDING";
}

// Keeps the booking's status and total in step with its items. Call inside the same transaction.
export async function syncBooking(tx: Prisma.TransactionClient, bookingId: string) {
  const items = await tx.bookingItem.findMany({ where: { bookingId }, select: { status: true, price: true } });
  const totalAmount = items.filter((i) => ACTIVE_ITEM.includes(i.status)).reduce((sum, i) => sum + i.price, 0);
  await tx.booking.update({ where: { id: bookingId }, data: { status: deriveBookingStatus(items), totalAmount } });
}

export function logBookingEvent(
  tx: Prisma.TransactionClient,
  e: { bookingId: string; itemId?: string; actorId: string | null; type: string; message: string }
) {
  return tx.bookingEvent.create({ data: e });
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
