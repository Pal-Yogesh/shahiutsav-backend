import type { Prisma } from "../generated/prisma/client.js";

// The single definition of what customers can see and book.
// A service is bookable when approved, not paused and not removed.
export const LIVE_SERVICE = { status: "LIVE", isActive: true, archivedAt: null } satisfies Prisma.ServiceWhereInput;

// A vendor is public when approved, not paused, and offering at least one live service
export const PUBLIC_VENDOR = {
  status: "APPROVED",
  isActive: true,
  services: { some: LIVE_SERVICE },
} satisfies Prisma.VendorProfileWhereInput;
