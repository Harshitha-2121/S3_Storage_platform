import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Shared policy for auth email delivery (OTP sign-in, signup verification,
 * password reset).
 *
 * Security invariants:
 * 1. A generated code must NEVER be written to logs that are visible to
 *    HTTP/websocket clients. Convex redacts client-visible log lines only when
 *    the backend runs with REDACT_LOGS_TO_CLIENT=true, so we must not rely on
 *    that: never log the code except under the explicit dev fallback flag.
 * 2. If no email provider is configured, fail closed with an operational
 *    error — the flow must not continue as though a code was delivered, and
 *    the code must not be logged.
 * 3. If delivery fails (provider rejection, outage) outside the explicit dev
 *    fallback, abort the sign-in with a sanitized error so a valid but
 *    undelivered credential is not silently left in place.
 *
 * Dev fallback: set `AUTH_DEV_FALLBACK=1` on the Convex deployment to keep the
 * local/CI convenience behavior (code printed to server-side console, delivery
 * failures tolerated so sandbox recipients still complete auth). Never set
 * this in production.
 */

export function authEmailProviderConfigured(): boolean {
  return Boolean(process.env.OLLASTACK_API_KEY);
}

export function authDevFallbackEnabled(): boolean {
  return process.env.AUTH_DEV_FALLBACK === "1";
}

/** Redacted, code-free log line noting that an auth code email was generated. */
export function logAuthEmailGenerated(label: string, email: string): void {
  console.warn(
    `[auth] ${label} code generated for ${email} (delivery attempted via email provider)`,
  );
}

/**
 * Dev-only: log the code to the server console so local development works.
 * Only reachable when authDevFallbackEnabled() is true.
 */
export function logDevFallbackCode(
  label: string,
  email: string,
  token: string,
): void {
  console.warn(
    `[auth] ${label} code for ${email}: ${token} (AUTH_DEV_FALLBACK — server logs only)`,
  );
}

type AuthEmailCtx = {
  runAction?: (ref: unknown, args: unknown) => Promise<unknown>;
  scheduler?: {
    runAfter: (delay: number, ref: unknown, args: unknown) => Promise<unknown>;
  };
};

/**
 * Dispatch an internal email (runAction when available, scheduler otherwise).
 * Callers provide the preformatted body; the body is never logged here.
 */
export async function dispatchAuthEmail(
  ctx: AuthEmailCtx | undefined,
  email: string,
  subject: string,
  body: string,
): Promise<void> {
  const args = { to: email, subject, text: body };
  if (ctx?.runAction) {
    await ctx.runAction(internal.email.sendEmail, args);
    return;
  }
  if (ctx?.scheduler) {
    await ctx.scheduler.runAfter(0, internal.email.sendEmail, args);
  }
}

/**
 * Resolve a delivery failure into provider behavior. Logs the provider reason
 * for operators, then either tolerates it (explicit dev fallback) or throws a
 * sanitized error (no token, no provider internals) that aborts the auth flow.
 */
export function handleAuthDeliveryFailure(
  label: string,
  email: string,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[email] ${label} delivery failed for ${email}: ${message}`);
  if (authDevFallbackEnabled()) {
    return;
  }
  throw new ConvexError(
    "Unable to deliver the verification code by email. Please try again later or contact support if the problem persists.",
  );
}
