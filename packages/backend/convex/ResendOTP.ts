import { Email } from "@convex-dev/auth/providers/Email";
import {
  authDevFallbackEnabled,
  authEmailProviderConfigured,
  dispatchAuthEmail,
  handleAuthDeliveryFailure,
  logAuthEmailGenerated,
  logDevFallbackCode,
} from "./authEmailDelivery";

/**
 * Magic email OTP provider (passwordless) using Ollastack API.
 * Sends the code via Ollastack API using a Convex action (no timeout limit).
 * Follows strict fail-closed and dev-fallback redaction policy.
 */
export const OllastackOTP = Email({
  id: "ollastack-otp",
  apiKey: process.env.OLLASTACK_API_KEY,
  maxAge: 60 * 15, // code valid for 15 minutes
  async generateVerificationToken() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => (b % 10).toString()).join("");
  },
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    ctx?: {
      runAction?: (ref: unknown, args: unknown) => Promise<unknown>;
      scheduler?: {
        runAfter: (delay: number, ref: unknown, args: unknown) => Promise<unknown>;
      };
    },
  ) {
    if (!authEmailProviderConfigured()) {
      if (authDevFallbackEnabled()) {
        logDevFallbackCode("sign-in OTP", email, token);
        return;
      }
      handleAuthDeliveryFailure(
        "sign-in OTP",
        email,
        new Error("Email provider not configured (OLLASTACK_API_KEY missing)"),
      );
      return;
    }

    logAuthEmailGenerated("sign-in OTP", email);

    try {
      await dispatchAuthEmail(
        ctx,
        email,
        "Your sign-in code",
        `Your sign-in code is: ${token}\n\nThis code expires in 15 minutes.`,
      );
    } catch (e) {
      handleAuthDeliveryFailure("sign-in OTP", email, e);
    }
  },
});

/**
 * Backward compatibility alias for existing callers.
 */
export const ResendOTP = Email({
  id: "resend-otp",
  apiKey: process.env.OLLASTACK_API_KEY,
  maxAge: 60 * 15,
  generateVerificationToken: OllastackOTP.generateVerificationToken,
  sendVerificationRequest: OllastackOTP.sendVerificationRequest,
});

