import { Resend } from "resend";
import { config } from "../config/index.js";

let resend: Resend | undefined;

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Branded wrapper shared by every email. `body` must already be escaped HTML.
export function emailLayout({ heading, body, cta }: { heading: string; body: string; cta?: { label: string; href: string } }) {
  return `
  <div style="background:#FAF7F1;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#191619">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #E8D6B5">
      <div style="background:#651E2D;padding:20px 28px;color:#E8D6B5;font-family:Georgia,serif;font-size:22px;letter-spacing:1px">${escapeHtml(config.appName)}</div>
      <div style="padding:28px">
        <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>
        <div style="font-size:15px;line-height:1.6;color:#4a4542">${body}</div>
        ${cta ? `<a href="${escapeHtml(cta.href)}" style="display:inline-block;margin-top:24px;background:#651E2D;color:#FAF7F1;padding:13px 24px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase">${escapeHtml(cta.label)}</a>` : ""}
      </div>
    </div>
  </div>`;
}

// Throws on failure. Resend reports errors in the result rather than throwing, so check it.
export async function sendEmail({ to, subject, html }: { to: string | string[]; subject: string; html: string }) {
  resend ??= new Resend(config.resendApiKey);
  const { error } = await resend.emails.send({ from: config.emailFrom, to, subject, html });
  if (error) throw new Error(`${error.name}: ${error.message}`);
}

// For notifications that must not fail the request that triggered them
export function sendEmailInBackground(message: Parameters<typeof sendEmail>[0], label: string) {
  sendEmail(message).catch((err) => console.error(`[email] ${label} failed:`, err instanceof Error ? err.message : err));
}
