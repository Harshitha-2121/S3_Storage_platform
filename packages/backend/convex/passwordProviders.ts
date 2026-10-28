import { Email } from "@convex-dev/auth/providers/Email";
import {
  authDevFallbackEnabled,
  authEmailProviderConfigured,
  dispatchAuthEmail,
  handleAuthDeliveryFailure,
  logAuthEmailGenerated,
  logDevFallbackCode,
} from "./authEmailDelivery";

// Email providers for password-reset and email-verification codes using Ollastack API.

type Ctx = {
  runAction?: (ref: unknown, args: unknown) => Promise<unknown>;
  scheduler?: {
    runAfter: (delay: number, ref: unknown, args: unknown) => Promise<unknown>;
  };
};

function genCode() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => (x % 10).toString()).join("");
}

async function send(
  ctx: Ctx | undefined,
  label: string,
  email: string,
  token: string,
) {
  if (!authEmailProviderConfigured()) {
    if (authDevFallbackEnabled()) {
      logDevFallbackCode(label, email, token);
      return;
    }
    handleAuthDeliveryFailure(
      label,
      email,
      new Error("Email provider not configured (OLLASTACK_API_KEY missing)"),
    );
    return;
  }

  logAuthEmailGenerated(label, email);

  try {
    await dispatchAuthEmail(
      ctx,
      email,
      `Your ${label} code`,
      `Your ${label} code is: ${token}\n\nThis code expires in 15 minutes.`,
    );
  } catch (e) {
    handleAuthDeliveryFailure(label, email, e);
  }
}

export const OllastackOTPVerify = Email({
  id: "verify-otp",
  apiKey: process.env.OLLASTACK_API_KEY,
  maxAge: 60 * 15,
  generateVerificationToken: async () => genCode(),
  sendVerificationRequest: async (
    { identifier, token }: { identifier: string; token: string },
    ctx?: Ctx,
  ) => send(ctx, "email verification", identifier, token),
});

export const OllastackOTPReset = Email({
  id: "password-reset",
  apiKey: process.env.OLLASTACK_API_KEY,
  maxAge: 60 * 15,
  generateVerificationToken: async () => genCode(),
  sendVerificationRequest: async (
    { identifier, token }: { identifier: string; token: string },
    ctx?: Ctx,
  ) => send(ctx, "password reset", identifier, token),
});

/** Backward compatibility aliases */
export const ResendOTPVerify = OllastackOTPVerify;
export const ResendOTPReset = OllastackOTPReset;

