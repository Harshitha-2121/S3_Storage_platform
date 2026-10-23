import { Email } from "@convex-dev/auth/providers/Email";
import { internal } from "./_generated/api";

/**
 * Magic email OTP provider (passwordless).
 * Sends the code via Resend API using a Convex action (no timeout limit).
 * Falls back to console.warn in dev if the key is missing.
 */
export const ResendOTP = Email({
  id: "resend-otp",
  apiKey: process.env.RESEND_API_KEY,
  maxAge: 60 * 15, // code valid for 15 minutes
  async generateVerificationToken() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => (b % 10).toString()).join("");
  },
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    ctx?: { runAction: (ref: unknown, args: unknown) => Promise<unknown>; scheduler?: { runAfter: (delay: number, ref: unknown, args: unknown) => Promise<unknown> } },
  ) {
    // Always log as dev fallback — the code is visible in Convex logs
    console.warn(`[auth] OTP for ${email}: ${token}`);

    if (!process.env.RESEND_API_KEY) {
      console.warn("[auth] RESEND_API_KEY not set — email not sent");
      return;
    }

    // Prefer runAction to immediately confirm provider acceptance,
    // or fall back to scheduler if runAction is not available.
    if (ctx?.runAction) {
      await ctx.runAction(internal.email.sendEmail, {
        to: email,
        subject: "Your sign-in code",
        text: `Your sign-in code is: ${token}\n\nThis code expires in 15 minutes.`,
      });
    } else if (ctx?.scheduler) {
      await ctx.scheduler.runAfter(0, internal.email.sendEmail, {
        to: email,
        subject: "Your sign-in code",
        text: `Your sign-in code is: ${token}\n\nThis code expires in 15 minutes.`,
      });
    }
  },
});
