import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, admin } from "better-auth/plugins";
import { getDb } from "./db.js";
import { sendEmail } from "./email.js";
import { config } from "../config/index.js";

export const auth = betterAuth({
  basePath: "/api/auth",
  secret: config.betterAuthSecret,
  baseURL: config.betterAuthUrl,
  // The frontend runs on a different origin; Better Auth rejects requests from origins not listed here
  trustedOrigins: [config.corsOrigin],
  database: prismaAdapter(getDb(), {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: false,
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      sendVerificationOTP: async ({ email, otp }) => {
        try {
          await sendEmail({
            to: email,
            subject: `${otp} is your ${config.appName} verification code`,
            html: `
            <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #1a1a1a; margin-bottom: 8px;">${config.appName}</h2>
              <p style="color: #555; margin-bottom: 24px;">Enter this code to verify your email:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px;">
                ${otp}
              </div>
              <p style="color: #888; font-size: 13px; margin-top: 24px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
            </div>
          `,
          });
        } catch (err) {
          console.error(`[email] Could not send sign-in code to ${email}:`, err instanceof Error ? err.message : err);
          throw new Error("Could not send the verification email");
        }
      },
    }),
    admin({
      defaultRole: "customer",
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "customer",
        // Never accept a role from the client (otherwise anyone could sign up as "admin").
        // Vendors are promoted server-side when an admin approves their application.
        input: false,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
