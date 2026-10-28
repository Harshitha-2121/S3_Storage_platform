import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { audit } from "./auditLog";
import { notify } from "./notifications";
import type { Id } from "./_generated/dataModel";

/**
 * Email sender via Ollastack API.
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
    const apiKey = process.env.OLLASTACK_API_KEY;
    if (!apiKey) {
      console.warn("[email] OLLASTACK_API_KEY not set, logging recipient/subject only:");
      console.log(`[email] to: ${to}, subject: ${subject}`);
      return;
    }
    const label = context ?? "Email";
    const baseUrl = process.env.OLLASTACK_API_URL ?? "https://login.ollastack.com";

    // Resolve target mailbox
    let mailboxId = process.env.OLLASTACK_MAILBOX_ID;
    if (!mailboxId) {
      try {
        const mbRes = await fetch(`${baseUrl}/api/mailboxes?limit=1`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (mbRes.ok) {
          const mbData = (await mbRes.json()) as {
            data?: { mailboxes?: Array<{ id: string }> };
          };
          mailboxId = mbData?.data?.mailboxes?.[0]?.id;
        }
      } catch {
        // Fall back to default
      }
      if (!mailboxId) {
        mailboxId = "default";
      }
    }

    try {
      const res = await fetch(`${baseUrl}/api/mailboxes/${mailboxId}/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          subject,
          text,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMessage = errText;
        try {
          const parsed = JSON.parse(errText) as { error?: { message?: string } };
          if (parsed?.error?.message) errMessage = parsed.error.message;
        } catch {
          // Keep raw error text
        }
        console.warn(`[email] Ollastack delivery notice (${res.status}): ${errMessage}`);
        throw new Error(`Ollastack send failed (${res.status}): ${errMessage}`);
      }

      let messageId = "unknown";
      try {
        const data = (await res.json()) as { data?: { id?: string } };
        if (data?.data?.id) messageId = data.data.id;
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
        `To ${a.to}: ${a.error ?? "unknown error"}. Check logs or verify mailbox in Ollastack dashboard.`,
      );
    }
  },
});