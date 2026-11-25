import { getDb } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import { escapeHtml, emailLayout, sendEmailInBackground } from "../lib/email.js";
import { config } from "../config/index.js";
import { allowedAdminActions, transition, type VendorAction } from "./vendor-workflow.js";
import type { Prisma, VendorStatus } from "../generated/prisma/client.js";

const STATUSES: VendorStatus[] = ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "SUSPENDED"];

export async function getStatusCounts() {
  const rows = await getDb().vendorProfile.groupBy({ by: ["status"], _count: { _all: true } });
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<VendorStatus, number>;
  for (const r of rows) counts[r.status] = r._count._all;
  return counts;
}

export async function listApplications({ status, q, page, limit }: { status?: VendorStatus; q?: string; page: number; limit: number }) {
  const db = getDb();
  const where: Prisma.VendorProfileWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { businessName: { contains: q, mode: "insensitive" } },
            { contactName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { user: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  // The review queue is first come, first served; everything else shows newest activity first
  const orderBy: Prisma.VendorProfileOrderByWithRelationInput[] =
    status === "SUBMITTED" ? [{ submittedAt: "asc" }] : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    db.vendorProfile.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        businessName: true,
        contactName: true,
        phone: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        createdAt: true,
        city: { select: { name: true } },
        user: { select: { email: true } },
        services: { select: { category: { select: { name: true } } } },
      },
    }),
    db.vendorProfile.count({ where }),
  ]);

  const data = rows.map(({ services, user, city, ...r }) => ({
    ...r,
    email: user.email,
    city: city.name,
    categories: [...new Set(services.map((s) => s.category.name))],
  }));
  return { data, total };
}

export async function getApplication(id: string) {
  const p = await getDb().vendorProfile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, emailVerified: true, createdAt: true } },
      city: { select: { id: true, name: true, slug: true, state: true } },
      services: {
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, description: true, priceType: true, price: true, status: true, isActive: true, category: { select: { name: true, slug: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, type: true, summary: true, createdAt: true, actor: { select: { name: true, role: true } } },
      },
      changeRequests: { where: { status: "PENDING" }, select: { id: true, changes: true, createdAt: true } },
      events: {
        orderBy: { createdAt: "desc" },
        select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { name: true, role: true } } },
      },
    },
  });
  if (!p) throw new HttpError(404, "Application not found");
  return { ...p, termsAccepted: !!p.termsAcceptedAt, allowedActions: allowedAdminActions(p.status) };
}

export async function decide({ id, action, note, adminId }: { id: string; action: Exclude<VendorAction, "submit">; note?: string; adminId: string }) {
  await transition({ vendorId: id, action, actorId: adminId, note });
  const app = await getApplication(id);
  notifyVendor(app, action, note?.trim());
  return app;
}

const DECISION_EMAIL: Record<Exclude<VendorAction, "submit">, { subject: string; heading: string; intro: string; cta: string }> = {
  approve: {
    subject: "You're live on {app}",
    heading: "Welcome aboard. You're live!",
    intro: "Congratulations, {business} has been approved. Customers can now find you in search and book your services.",
    cta: "See your listing",
  },
  request_changes: {
    subject: "A few changes needed for your {app} application",
    heading: "Almost there",
    intro: "Thanks for applying with {business}. Our team needs a few changes before we can approve it:",
    cta: "Update application",
  },
  reject: {
    subject: "Your {app} application",
    heading: "About your application",
    intro: "Thank you for your interest in partnering with us. We're unable to approve {business} at this time.",
    cta: "View details",
  },
  suspend: {
    subject: "Your {app} listing is paused",
    heading: "Your listing is paused",
    intro: "{business} is temporarily hidden from customers.",
    cta: "View details",
  },
  reinstate: {
    subject: "Your {app} listing is live again",
    heading: "You're back online",
    intro: "{business} is visible to customers again.",
    cta: "See your listing",
  },
  reopen: {
    subject: "Your {app} application has been reopened",
    heading: "Your application is open again",
    intro: "We've reopened the application for {business}. Please review the note below and resubmit:",
    cta: "Update application",
  },
};

function notifyVendor(app: Awaited<ReturnType<typeof getApplication>>, action: Exclude<VendorAction, "submit">, note?: string) {
  const t = DECISION_EMAIL[action];
  const fill = (s: string) => s.replace("{app}", config.appName).replace("{business}", escapeHtml(app.businessName));
  const live = action === "approve" || action === "reinstate";
  sendEmailInBackground(
    {
      to: app.user.email,
      subject: fill(t.subject),
      html: emailLayout({
        heading: t.heading,
        body: `<p>${fill(t.intro)}</p>${note ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #C6A15B;background:#FAF7F1">${escapeHtml(note).replace(/\n/g, "<br>")}</blockquote>` : ""}`,
        cta: { label: t.cta, href: live ? `${config.appUrl}/vendors/${app.slug}` : `${config.appUrl}/vendor/onboarding` },
      }),
    },
    `vendor ${action} notice`
  );
}
