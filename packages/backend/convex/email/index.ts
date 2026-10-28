import { z } from "zod";
import { env } from "../env";

const OllastackSuccessSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      id: z.string(),
    })
    .optional(),
});

export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
};

export async function sendEmail(options: SendEmailOptions) {
  const apiKey = env.OLLASTACK_API_KEY ?? process.env.OLLASTACK_API_KEY;
  if (!apiKey) {
    console.warn("[email] OLLASTACK_API_KEY not set, logging recipient/subject only:");
    console.log(
      `[email] to: ${Array.isArray(options.to) ? options.to.join(", ") : options.to}, subject: ${options.subject}`,
    );
    return { status: "simulated" } as const;
  }

  const baseUrl =
    env.OLLASTACK_API_URL ??
    process.env.OLLASTACK_API_URL ??
    "https://login.ollastack.com";
  let mailboxId = env.OLLASTACK_MAILBOX_ID ?? process.env.OLLASTACK_MAILBOX_ID;

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
    } catch {}
    if (!mailboxId) mailboxId = "default";
  }

  const to = Array.isArray(options.to) ? options.to[0] : options.to;
  const payload = {
    to,
    subject: options.subject,
    text: options.text ?? options.html ?? "",
    html: options.html,
  };

  const response = await fetch(`${baseUrl}/api/mailboxes/${mailboxId}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (response.ok) {
    return { status: "success", data } as const;
  }

  const errMessage =
    (data as { error?: { message?: string } })?.error?.message ??
    `HTTP ${response.status}`;
  throw new Error(`Error sending email: ${errMessage}`);
}

