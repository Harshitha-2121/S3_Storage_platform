import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    CONVEX_SITE_URL: z.string().url(),
    LOOPS_FORM_ID: z.optional(z.string().min(1)),
    POLAR_ORGANIZATION_TOKEN: z.string().min(1),
    POLAR_WEBHOOK_SECRET: z.string().min(1),
    OLLASTACK_API_KEY: z.optional(z.string().min(1)),
    OLLASTACK_MAILBOX_ID: z.optional(z.string().min(1)),
    OLLASTACK_API_URL: z.optional(z.string().url()),
    SITE_URL: z.string().url(),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
  },
  runtimeEnv: {
    CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
    LOOPS_FORM_ID: process.env.LOOPS_FORM_ID,
    POLAR_ORGANIZATION_TOKEN: process.env.POLAR_ORGANIZATION_TOKEN,
    POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
    OLLASTACK_API_KEY: process.env.OLLASTACK_API_KEY,
    OLLASTACK_MAILBOX_ID: process.env.OLLASTACK_MAILBOX_ID,
    OLLASTACK_API_URL: process.env.OLLASTACK_API_URL,
    SITE_URL: process.env.SITE_URL,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
  },
  skipValidation: !process.env.VALIDATE_ENV,
});
