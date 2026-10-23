import { Email } from "@convex-dev/auth/providers/Email";
import { internal } from "./_generated/api";

// Email providers for password-reset and email-verification codes.
// The code is logged (dev fallback) AND, when SMTP is configured, emailed via the
// Node SMTP action (e.g. a local Mailpit inbox).

type Ctx = { runAction: (ref: unknown, args: unknown) => Promise<unknown> };

function genCode() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => (x % 10).toString()).join("");
}
async function send(
  ctx: { runAction?: (ref: unknown, args: unknown) => Promise<unknown>; scheduler?: { runAfter: (delay: number, ref: unknown, args: unknown) => Promise<unknown> } } | undefined,
  label: string,
  email: string,
  token: string,
) {
  console.warn(`[auth] ${label} code for ${email}: ${token}`); // dev fallback
  if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) {
    if (ctx?.runAction) {
      await ctx.runAction(internal.email.sendEmail, {
        to: email,
        subject: `Your ${label} code`,
        text: `Your ${label} code is ${token}`,
      });
    } else if (ctx?.scheduler) {
      await ctx.scheduler.runAfter(0, internal.email.sendEmail, {
        to: email,
        subject: `Your ${label} code`,
        text: `Your ${label} code is ${token}`,
      });
    }
  }
}

export const ResendOTPVerify = Email({
  id: "verify-otp",
  apiKey: process.env.RESEND_API_KEY,
  maxAge: 60 * 15,
  generateVerificationToken: async () => genCode(),
  sendVerificationRequest: async (
    { identifier, token }: { identifier: string; token: string },
    ctx?: Ctx,
  ) => send(ctx, "email verification", identifier, token),
});

export const ResendOTPReset = Email({
  id: "password-reset",
  apiKey: process.env.RESEND_API_KEY,
  maxAge: 60 * 15,
  generateVerificationToken: async () => genCode(),
  sendVerificationRequest: async (
    { identifier, token }: { identifier: string; token: string },
    ctx?: Ctx,
  ) => send(ctx, "password reset", identifier, token),
});
