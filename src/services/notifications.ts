import { getDb } from "../lib/db.js";
import { config } from "../config/index.js";
import { emailLayout, escapeHtml, sendEmailInBackground } from "../lib/email.js";

export { escapeHtml };

// Emails every admin. Never blocks or fails the request that triggered it.
export async function notifyAdmins({ subject, heading, body, path }: { subject: string; heading: string; body: string; path: string }) {
  try {
    const admins = await getDb().user.findMany({ where: { role: "admin" }, select: { email: true } });
    if (!admins.length) return;
    sendEmailInBackground(
      { to: admins.map((a) => a.email), subject, html: emailLayout({ heading, body, cta: { label: "Review now", href: `${config.appUrl}${path}` } }) },
      `admin notice: ${subject}`
    );
  } catch (err) {
    console.error("[email] Could not look up admins:", err instanceof Error ? err.message : err);
  }
}

export function notifyVendor({ to, subject, heading, body, note, cta }: { to: string; subject: string; heading: string; body: string; note?: string | null; cta: { label: string; path: string } }) {
  const noteHtml = note
    ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #C6A15B;background:#FAF7F1">${escapeHtml(note).replace(/\n/g, "<br>")}</blockquote>`
    : "";
  sendEmailInBackground(
    { to, subject, html: emailLayout({ heading, body: body + noteHtml, cta: { label: cta.label, href: `${config.appUrl}${cta.path}` } }) },
    `vendor notice: ${subject}`
  );
}
