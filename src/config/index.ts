import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL!,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET!,
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  // Must use a domain verified in your Resend account, e.g. "ShahiUtsav <noreply@yourdomain.com>"
  emailFrom: process.env.EMAIL_FROM ?? "ShahiUtsav <onboarding@resend.dev>",
  appName: process.env.APP_NAME ?? "ShahiUtsav",
  // Public website address, used for links in emails
  appUrl: process.env.APP_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:3000",
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 12,
  MAX_LIMIT: 50,
} as const;

export const EVENT_TYPES = [
  "Wedding",
  "Birthday",
  "Anniversary",
  "Engagement",
  "Corporate Event",
  "College Event",
  "Religious Function",
  "Concert",
  "Private Party",
  "Other",
] as const;
