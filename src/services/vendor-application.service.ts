import { randomBytes } from "node:crypto";
import { getDb, TX_OPTIONS } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import { escapeHtml, emailLayout, sendEmailInBackground } from "../lib/email.js";
import { config } from "../config/index.js";
import { EDITABLE_STATUSES, transition } from "./vendor-workflow.js";
import { MIN_DESCRIPTION, type ApplicationDraftInput } from "../validators/vendor-application.validator.js";
import type { Prisma } from "../generated/prisma/client.js";

export const PRICE_UNITS: Record<string, string> = {
  FIXED: "per event",
  STARTING_FROM: "onwards",
  PER_HOUR: "per hour",
  PER_DAY: "per day",
  PER_PLATE: "per plate",
};

const applicationInclude = {
  city: { select: { id: true, name: true, slug: true, state: true } },
  services: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      categoryId: true,
      title: true,
      description: true,
      priceType: true,
      price: true,
      category: { select: { name: true, slug: true } },
    },
  },
  events: {
    orderBy: { createdAt: "desc" },
    select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true },
  },
} satisfies Prisma.VendorProfileInclude;

type ApplicationRecord = Prisma.VendorProfileGetPayload<{ include: typeof applicationInclude }> & { termsAccepted: boolean };

// What is still missing before the application can be submitted, as field → message
export function missingForSubmit(p: ApplicationRecord): Record<string, string> {
  const missing: Record<string, string> = {};
  if (!p.contactName) missing.contactName = "Add the name of the person we should speak to";
  if (!p.phone) missing.phone = "Add a mobile number";
  if (!p.address) missing.address = "Add your business address";
  if (!p.pincode) missing.pincode = "Add your pincode";
  if (!p.description || p.description.length < MIN_DESCRIPTION)
    missing.description = `Describe your business in at least ${MIN_DESCRIPTION} characters`;
  if (p.services.length === 0) missing.services = "Add at least one service you offer";
  if (!p.termsAccepted) missing.termsAccepted = "Accept the partner terms to continue";
  return missing;
}

function toDTO(p: ApplicationRecord) {
  const { termsAcceptedAt: _terms, userId: _userId, ...rest } = p;
  return {
    ...rest,
    canEdit: EDITABLE_STATUSES.includes(p.status),
    missing: missingForSubmit(p),
  };
}

async function loadByUser(userId: string): Promise<ApplicationRecord | null> {
  const p = await getDb().vendorProfile.findUnique({ where: { userId }, include: applicationInclude });
  return p ? { ...p, termsAccepted: !!p.termsAcceptedAt } : null;
}

function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "vendor"
  );
}

async function uniqueSlug(name: string, excludeId?: string) {
  const db = getDb();
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const taken = await db.vendorProfile.findFirst({ where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export async function getMyApplication(userId: string) {
  const p = await loadByUser(userId);
  return p ? toDTO(p) : null;
}

export async function saveDraft(userId: string, input: ApplicationDraftInput) {
  const db = getDb();
  const existing = await db.vendorProfile.findUnique({
    where: { userId },
    select: { id: true, status: true, businessName: true },
  });

  if (existing && !EDITABLE_STATUSES.includes(existing.status)) {
    throw new HttpError(409, "Your application is with our team, so it can't be edited right now.");
  }
  if (!existing && (!input.businessName || !input.cityId)) {
    throw new HttpError(422, "Add your business name and city to save your application", {
      ...(input.businessName ? {} : { businessName: "Enter your business name" }),
      ...(input.cityId ? {} : { cityId: "Choose your city" }),
    });
  }

  // Referenced rows must exist and be active
  if (input.cityId) {
    const city = await db.city.findFirst({ where: { id: input.cityId, isActive: true }, select: { id: true } });
    if (!city) throw new HttpError(422, "Choose a city from the list", { cityId: "Choose a city from the list" });
  }
  if (input.services?.length) {
    const ids = [...new Set(input.services.map((s) => s.categoryId))];
    const found = await db.serviceCategory.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
    const valid = new Set(found.map((c) => c.id));
    const fieldErrors: Record<string, string> = {};
    input.services.forEach((s, i) => {
      if (!valid.has(s.categoryId)) fieldErrors[`services.${i}.categoryId`] = "Choose a category from the list";
    });
    if (Object.keys(fieldErrors).length) throw new HttpError(422, "Please check your services", fieldErrors);
  }

  const { services, termsAccepted, ...fields } = input;
  const data = {
    ...fields,
    ...(termsAccepted === undefined ? {} : { termsAcceptedAt: termsAccepted ? new Date() : null }),
  };

  // Lookups happen before the transaction so it only holds the writes
  const renamed = !!existing && !!input.businessName && input.businessName !== existing.businessName;
  const slug = !existing ? await uniqueSlug(input.businessName!) : renamed ? await uniqueSlug(input.businessName!, existing.id) : undefined;

  await db.$transaction(async (tx) => {
    let vendorId = existing?.id;
    if (!existing) {
      const created = await tx.vendorProfile.create({
        data: {
          ...data,
          userId,
          businessName: input.businessName!,
          cityId: input.cityId!,
          slug: slug!,
        },
        select: { id: true },
      });
      vendorId = created.id;
      await tx.vendorStatusEvent.create({ data: { vendorId, toStatus: "DRAFT", actorId: userId } });
    } else {
      // Not yet public, so the URL can follow a rename
      await tx.vendorProfile.update({ where: { id: existing.id }, data: { ...data, ...(slug ? { slug } : {}) } });
    }

    // Services are replaced as a set. Safe: nothing can be booked before approval.
    if (services) {
      await tx.service.deleteMany({ where: { vendorId } });
      if (services.length) {
        await tx.service.createMany({
          data: services.map((s) => ({ ...s, vendorId: vendorId!, priceUnit: PRICE_UNITS[s.priceType], images: [] })),
        });
      }
    }
  }, TX_OPTIONS);

  return getMyApplication(userId);
}

export async function submitApplication(userId: string) {
  const p = await loadByUser(userId);
  if (!p) throw new HttpError(404, "Start your application first");

  const missing = missingForSubmit(p);
  if (Object.keys(missing).length) {
    throw new HttpError(422, "A few details are still missing", missing);
  }

  await transition({ vendorId: p.id, action: "submit", actorId: userId });
  notifyAdminsOfSubmission(p.id, p.businessName, p.city.name, p.status === "CHANGES_REQUESTED");
  return getMyApplication(userId);
}

async function notifyAdminsOfSubmission(vendorId: string, businessName: string, city: string, isResubmission: boolean) {
  const admins = await getDb().user.findMany({ where: { role: "admin" }, select: { email: true } });
  if (!admins.length) return;
  sendEmailInBackground(
    {
      to: admins.map((a) => a.email),
      subject: `${isResubmission ? "Updated" : "New"} vendor application: ${businessName}`,
      html: emailLayout({
        heading: isResubmission ? "An application was updated" : "New vendor application",
        body: `<p><strong>${escapeHtml(businessName)}</strong> from ${escapeHtml(city)} ${isResubmission ? "has made the changes you asked for" : "has applied to join"}. It's waiting in the review queue.</p>`,
        cta: { label: "Review application", href: `${config.appUrl}/admin/vendors/${vendorId}` },
      }),
    },
    "admin submission notice"
  );
}
