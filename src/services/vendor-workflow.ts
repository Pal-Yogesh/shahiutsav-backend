import { getDb, TX_OPTIONS } from "../lib/db.js";
import { HttpError } from "../helpers/http-error.js";
import type { VendorStatus } from "../generated/prisma/client.js";

// Single source of truth for which status changes are allowed, and by whom.
// Every change goes through transition(), which also writes the audit trail.
export type VendorAction = "submit" | "approve" | "request_changes" | "reject" | "suspend" | "reinstate" | "reopen";

type Rule = { from: VendorStatus[]; to: VendorStatus; by: "vendor" | "admin"; noteRequired: boolean };

export const RULES: Record<VendorAction, Rule> = {
  submit: { from: ["DRAFT", "CHANGES_REQUESTED"], to: "SUBMITTED", by: "vendor", noteRequired: false },
  approve: { from: ["SUBMITTED"], to: "APPROVED", by: "admin", noteRequired: false },
  request_changes: { from: ["SUBMITTED"], to: "CHANGES_REQUESTED", by: "admin", noteRequired: true },
  reject: { from: ["SUBMITTED", "CHANGES_REQUESTED"], to: "REJECTED", by: "admin", noteRequired: true },
  suspend: { from: ["APPROVED"], to: "SUSPENDED", by: "admin", noteRequired: true },
  reinstate: { from: ["SUSPENDED"], to: "APPROVED", by: "admin", noteRequired: false },
  reopen: { from: ["REJECTED"], to: "CHANGES_REQUESTED", by: "admin", noteRequired: true },
};

// Vendors may edit their application only while it is with them
export const EDITABLE_STATUSES: VendorStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

export function allowedAdminActions(status: VendorStatus): VendorAction[] {
  return (Object.keys(RULES) as VendorAction[]).filter((a) => RULES[a].by === "admin" && RULES[a].from.includes(status));
}

export async function transition({
  vendorId,
  action,
  actorId,
  note,
}: {
  vendorId: string;
  action: VendorAction;
  actorId: string;
  note?: string;
}) {
  const rule = RULES[action];
  const cleanNote = note?.trim() || null;
  if (rule.noteRequired && !cleanNote) {
    throw new HttpError(422, "Add a note for the vendor explaining why", { note: "A note is required for this action" });
  }

  const db = getDb();
  const now = new Date();

  return db.$transaction(async (tx) => {
    const current = await tx.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { status: true, userId: true, user: { select: { role: true } } },
    });
    if (!current) throw new HttpError(404, "Application not found");

    // Conditional update: succeeds only if nobody changed the status since we read it
    const { count } = await tx.vendorProfile.updateMany({
      where: { id: vendorId, status: { in: rule.from } },
      data: {
        status: rule.to,
        ...(action === "submit" ? { submittedAt: now } : { reviewedAt: now, reviewNote: cleanNote }),
        ...(rule.to === "APPROVED" ? { approvedAt: now, isVerified: true, isActive: true } : {}),
        ...(rule.to === "SUSPENDED" || rule.to === "REJECTED" ? { isVerified: false } : {}),
      },
    });
    if (count === 0) {
      throw new HttpError(
        409,
        rule.from.includes(current.status)
          ? "This application was just updated by someone else. Refresh and try again."
          : `This can't be done while the application is ${current.status.toLowerCase().replace("_", " ")}.`
      );
    }

    // The services submitted with the application go live with it
    if (action === "approve") {
      await tx.service.updateMany({ where: { vendorId, status: "PENDING", archivedAt: null }, data: { status: "LIVE" } });
    }

    // Approval grants the vendor role; never downgrade an admin who is also a vendor
    if (rule.to === "APPROVED" && current.user.role === "customer") {
      await tx.user.update({ where: { id: current.userId }, data: { role: "vendor" } });
    }

    await tx.vendorStatusEvent.create({
      data: { vendorId, fromStatus: current.status, toStatus: rule.to, note: cleanNote, actorId },
    });

    return { from: current.status, to: rule.to };
  }, TX_OPTIONS);
}
