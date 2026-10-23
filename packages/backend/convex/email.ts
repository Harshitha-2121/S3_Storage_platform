import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { audit } from "./auditLog";
import { notify } from "./notifications";
import type { Id } from "./_generated/dataModel";

/**
 * Email sender via Resend API.
 *
 * Optional attribution (notifyUserId + workspaceId + context) routes the
 * outcome where the actor can see it: every send writes an audit row, and
 * failures additionally raise an in-app notification. Without attribution
 * the result only lands in the function logs.
 */
export const sendEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    notifyUserId: v.optional(v.id("users")),
    workspaceId: v.optional(v.id("workspaces")),
    context: v.optional(v.string()),
  },
  handler: async (ctx, { to, subject, text, notifyUserId, workspaceId, context }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[email] RESEND_API_KEY not set, logging only:");
      console.log(`[email] to: ${to}, subject: ${subject}, text: ${text}`);
      return;
    }
    const label = context ?? "Email";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_SENDER_EMAIL_AUTH ?? "onboarding@resend.dev",
          to,
          subject,
          text,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[email] Resend error: ${res.status} ${err}`);
        let parsedMessage = `Email delivery failed (${res.status})`;
        try {
          const errJson = JSON.parse(err);
          if (errJson?.message) {
            parsedMessage = errJson.message;
          }
        } catch {}
        throw new Error(parsedMessage);
      }
      // Log the Resend message id so delivery can be traced in the
      // Resend dashboard (Emails log) per recipient.
      let messageId = "unknown";
      try {
        const data = (await res.json()) as { id?: string };
        if (data.id) messageId = data.id;
      } catch {
        // Non-JSON receipt: keep the send itself successful.
      }
      console.log(`[email] Sent to ${to}: ${subject} id=${messageId}`);
      if (notifyUserId && workspaceId) {
        await ctx.runMutation(internal.email.recordEmailResult, {
          to,
          subject,
          ok: true,
          messageId,
          notifyUserId,
          workspaceId,
          context: label,
        });
      }
    } catch (e) {
      const message = (e as Error).message;
      if (notifyUserId && workspaceId) {
        await ctx.runMutation(internal.email.recordEmailResult, {
          to,
          subject,
          ok: false,
          error: message,
          notifyUserId,
          workspaceId,
          context: label,
        });
      }
      throw e;
    }
  },
});

/**
 * Record an email outcome where the actor can see it: audit row always,
 * in-app notification on failure. Called by sendEmail, not by clients.
 */
export const recordEmailResult = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    ok: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
    notifyUserId: v.id("users"),
    workspaceId: v.id("workspaces"),
    context: v.string(),
  },
  handler: async (ctx, a) => {
    await audit(ctx, a.workspaceId, a.notifyUserId, a.ok ? "email.sent" : "email.failed", {
      to: a.to,
      subject: a.subject,
      messageId: a.messageId,
      error: a.error,
      context: a.context,
    });
    if (!a.ok) {
      await notify(
        ctx,
        a.notifyUserId,
        "email",
        `${a.context} email failed`,
        `To ${a.to}: ${a.error ?? "unknown error"}. Check Logs or verify a domain at resend.com/domains.`,
      );
    }
  },
});