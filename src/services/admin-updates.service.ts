import { getDb, TX_OPTIONS } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import { escapeHtml, notifyVendor } from "./notifications.js";
import { logActivity } from "./vendor-portal.service.js";
import type { Prisma } from "../generated/prisma/client.js";

// Changes to live listings that need an admin: new categories and identity changes.
// (Services in a first-time application are reviewed with the application instead.)

const pendingServiceWhere: Prisma.ServiceWhereInput = { status: "PENDING", archivedAt: null, vendor: { status: { in: ["APPROVED", "SUSPENDED"] } } };

export async function countPendingUpdates() {
  const db = getDb();
  const [services, changes] = await Promise.all([
    db.service.count({ where: pendingServiceWhere }),
    db.vendorChangeRequest.count({ where: { status: "PENDING" } }),
  ]);
  return { services, changes, total: services + changes };
}

export async function listPendingUpdates() {
  const db = getDb();
  const [services, changes] = await Promise.all([
    db.service.findMany({
      where: pendingServiceWhere,
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        priceType: true,
        price: true,
        submittedAt: true,
        category: { select: { name: true } },
        vendor: { select: { id: true, businessName: true, city: { select: { name: true } }, services: { where: { status: "LIVE", archivedAt: null }, select: { category: { select: { name: true } } } } } },
      },
    }),
    db.vendorChangeRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, changes: true, previous: true, createdAt: true, vendor: { select: { id: true, businessName: true, city: { select: { name: true } } } } },
    }),
  ]);

  // Show city names, not ids
  const cityIds = changes.flatMap((c) => [(c.changes as Record<string, string>).cityId, (c.previous as Record<string, string>).cityId]).filter(Boolean);
  const cities = cityIds.length ? await db.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } }) : [];
  const cityName = new Map(cities.map((c) => [c.id, c.name]));
  const readable = (v: Record<string, string | null>) => (v.cityId ? { ...v, cityId: cityName.get(v.cityId) ?? v.cityId } : v);

  return {
    services: services.map(({ vendor, ...s }) => ({
      ...s,
      vendor: { id: vendor.id, businessName: vendor.businessName, city: vendor.city.name, liveCategories: [...new Set(vendor.services.map((x) => x.category.name))] },
    })),
    changes: changes.map((c) => ({
      ...c,
      changes: readable(c.changes as Record<string, string | null>),
      previous: readable(c.previous as Record<string, string | null>),
    })),
  };
}

export async function decideService({ id, action, note, adminId }: { id: string; action: "approve" | "reject"; note?: string; adminId: string }) {
  const cleanNote = note?.trim() || null;
  if (action === "reject" && !cleanNote) throw new HttpError(422, "Add a note telling the vendor why", { note: "A note is required to decline" });

  const db = getDb();
  const result = await db.$transaction(async (tx) => {
    const service = await tx.service.findFirst({
      where: { id, ...pendingServiceWhere },
      select: { title: true, vendorId: true, category: { select: { name: true } }, vendor: { select: { businessName: true, user: { select: { email: true } } } } },
    });
    if (!service) throw new HttpError(409, "This request was already handled. Refresh to see the latest.");
    const { count } = await tx.service.updateMany({
      where: { id, status: "PENDING" },
      data: action === "approve" ? { status: "LIVE", reviewNote: cleanNote } : { status: "REJECTED", reviewNote: cleanNote },
    });
    if (!count) throw new HttpError(409, "This request was already handled. Refresh to see the latest.");
    await logActivity(tx, {
      vendorId: service.vendorId,
      actorId: adminId,
      type: action === "approve" ? "CATEGORY_APPROVED" : "CATEGORY_DECLINED",
      summary: action === "approve" ? `${service.category.name} approved: "${service.title}" is live` : `${service.category.name} not approved for "${service.title}"`,
    });
    return service;
  }, TX_OPTIONS);

  notifyVendor({
    to: result.vendor.user.email,
    subject: action === "approve" ? `${result.category.name} is now live on your listing` : `About your ${result.category.name} request`,
    heading: action === "approve" ? "Your new service is live" : "We couldn't approve this service",
    body:
      action === "approve"
        ? `<p>“${escapeHtml(result.title)}” is approved. Customers can now find ${escapeHtml(result.vendor.businessName)} under <strong>${escapeHtml(result.category.name)}</strong>.</p>`
        : `<p>We couldn't approve “${escapeHtml(result.title)}” under ${escapeHtml(result.category.name)} yet. You can update it from your dashboard and it will come back to us for review.</p>`,
    note: cleanNote,
    cta: { label: "Open dashboard", path: "/vendor/dashboard?tab=services" },
  });
}

export async function decideChangeRequest({ id, action, note, adminId }: { id: string; action: "approve" | "reject"; note?: string; adminId: string }) {
  const cleanNote = note?.trim() || null;
  if (action === "reject" && !cleanNote) throw new HttpError(422, "Add a note telling the vendor why", { note: "A note is required to decline" });

  const db = getDb();
  const result = await db.$transaction(async (tx) => {
    const request = await tx.vendorChangeRequest.findFirst({
      where: { id, status: "PENDING" },
      select: { vendorId: true, changes: true, vendor: { select: { businessName: true, user: { select: { email: true } } } } },
    });
    if (!request) throw new HttpError(409, "This request was already handled. Refresh to see the latest.");

    const { count } = await tx.vendorChangeRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: action === "approve" ? "APPROVED" : "REJECTED", note: cleanNote, reviewerId: adminId, reviewedAt: new Date() },
    });
    if (!count) throw new HttpError(409, "This request was already handled. Refresh to see the latest.");

    if (action === "approve") {
      const { businessName, cityId, gstNumber } = request.changes as { businessName?: string; cityId?: string; gstNumber?: string | null };
      if (cityId && !(await tx.city.findFirst({ where: { id: cityId, isActive: true }, select: { id: true } }))) {
        throw new HttpError(409, "The requested city is no longer available. Decline and ask the vendor to choose another.");
      }
      // The public URL (slug) stays the same so shared links keep working
      await tx.vendorProfile.update({
        where: { id: request.vendorId },
        data: { ...(businessName ? { businessName } : {}), ...(cityId ? { cityId } : {}), ...(gstNumber !== undefined ? { gstNumber } : {}) },
      });
    }
    await logActivity(tx, {
      vendorId: request.vendorId,
      actorId: adminId,
      type: action === "approve" ? "CHANGE_APPROVED" : "CHANGE_DECLINED",
      summary: action === "approve" ? "Business details change approved" : "Business details change declined",
    });
    return request;
  }, TX_OPTIONS);

  notifyVendor({
    to: result.vendor.user.email,
    subject: action === "approve" ? "Your business details are updated" : "About your requested change",
    heading: action === "approve" ? "Your changes are live" : "We couldn't make this change",
    body:
      action === "approve"
        ? `<p>The business details you asked to change are now updated on your listing.</p>`
        : `<p>We couldn't update your business details as requested.</p>`,
    note: cleanNote,
    cta: { label: "Open dashboard", path: "/vendor/dashboard?tab=profile" },
  });
}
