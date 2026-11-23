import { getDb } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import type { BookingDTO } from "../types/index.js";

type CreateBookingInput = {
  customerId: string;
  eventDate: Date;
  eventType: string;
  guestCount?: number;
  venue?: string;
  cityId: string;
  notes?: string;
  items: { vendorId: string; serviceId: string; notes?: string }[];
};

export async function createBooking(input: CreateBookingInput): Promise<BookingDTO> {
  const db = getDb();
  const { items: itemInputs, ...bookingData } = input;

  // Bookable = active service from an approved, active vendor. The vendor comes from
  // the service itself, never from the client, so items can't be misattributed.
  const serviceIds = [...new Set(itemInputs.map((i) => i.serviceId))];
  const services = await db.service.findMany({
    where: { id: { in: serviceIds }, isActive: true, vendor: { status: "APPROVED", isActive: true } },
    select: { id: true, price: true, vendorId: true },
  });
  if (services.length !== serviceIds.length) {
    throw new HttpError(422, "Some of these services are no longer available. Please review your selection.");
  }

  const byId = new Map(services.map((s) => [s.id, s]));
  const totalAmount = itemInputs.reduce((sum, item) => sum + byId.get(item.serviceId)!.price, 0);

  const booking = await db.booking.create({
    data: {
      ...bookingData,
      totalAmount,
      items: {
        create: itemInputs.map((item) => ({
          vendorId: byId.get(item.serviceId)!.vendorId,
          serviceId: item.serviceId,
          price: byId.get(item.serviceId)!.price,
          notes: item.notes,
        })),
      },
    },
    include: {
      city: { select: { id: true, name: true, slug: true, state: true } },
      items: {
        include: {
          vendor: { select: { businessName: true, slug: true, profileImage: true } },
          service: {
            select: { title: true, category: { select: { name: true } } },
          },
        },
      },
    },
  });

  return {
    id: booking.id,
    eventDate: booking.eventDate.toISOString(),
    eventType: booking.eventType,
    guestCount: booking.guestCount,
    venue: booking.venue,
    status: booking.status,
    totalAmount: booking.totalAmount,
    createdAt: booking.createdAt.toISOString(),
    city: booking.city,
    items: booking.items.map((item) => ({
      id: item.id,
      price: item.price,
      status: item.status,
      notes: item.notes,
      vendor: item.vendor,
      service: {
        title: item.service.title,
        category: item.service.category.name,
      },
    })),
  };
}

export async function getBookingsByCustomer(customerId: string, page: number, limit: number) {
  const db = getDb();
  const skip = (page - 1) * limit;

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where: { customerId },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        city: { select: { id: true, name: true, slug: true, state: true } },
        items: {
          include: {
            vendor: { select: { businessName: true, slug: true, profileImage: true } },
            service: {
              select: { title: true, category: { select: { name: true } } },
            },
          },
        },
      },
    }),
    db.booking.count({ where: { customerId } }),
  ]);

  const data: BookingDTO[] = bookings.map((b) => ({
    id: b.id,
    eventDate: b.eventDate.toISOString(),
    eventType: b.eventType,
    guestCount: b.guestCount,
    venue: b.venue,
    status: b.status,
    totalAmount: b.totalAmount,
    createdAt: b.createdAt.toISOString(),
    city: b.city,
    items: b.items.map((item) => ({
      id: item.id,
      price: item.price,
      status: item.status,
      notes: item.notes,
      vendor: item.vendor,
      service: {
        title: item.service.title,
        category: item.service.category.name,
      },
    })),
  }));

  return { data, total };
}
