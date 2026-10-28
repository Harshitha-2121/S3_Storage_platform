/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OllastackOTP, ResendOTP } from "../convex/ResendOTP";
import {
  authDevFallbackEnabled,
  authEmailProviderConfigured,
} from "../convex/authEmailDelivery";
import { sendEmail as sendEmailAction } from "../convex/email";
import {
  OllastackOTPReset,
  OllastackOTPVerify,
  ResendOTPReset,
  ResendOTPVerify,
} from "../convex/passwordProviders";

// Capture every console line so we can assert that generated tokens never leak.
type ConsoleCapture = { lines: string[]; tokenSeen: boolean; token?: string };
function spyConsole(capture: ConsoleCapture) {
  const record = (...parts: unknown[]) => {
    const line = parts.map(String).join(" ");
    capture.lines.push(line);
    if (capture.token && line.includes(capture.token)) capture.tokenSeen = true;
  };
  for (const lvl of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, lvl).mockImplementation(record);
  }
}

let envBackup: Record<string, string | undefined> = {};
const ENV_KEYS = ["OLLASTACK_API_KEY", "AUTH_DEV_FALLBACK", "SMTP_HOST"];

function setEnv(key: string, value: string | undefined) {
  envBackup[key] = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const PROVIDER_CTX = {
  runAction: async (_ref: unknown, _args: unknown) => ({}),
};

beforeEach(() => {
  envBackup = {};
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

describe("auth email delivery policy (OTP leak prevention)", () => {
  test("flags observed: provider configured is OLLASTACK_API_KEY; dev fallback is AUTH_DEV_FALLBACK only", () => {
    delete process.env.OLLASTACK_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.AUTH_DEV_FALLBACK;
    expect(authEmailProviderConfigured()).toBe(false);
    expect(authDevFallbackEnabled()).toBe(false);
    // SMTP was never implemented as a transport — it must not count as a provider.
    process.env.SMTP_HOST = "mailpit.local";
    expect(authEmailProviderConfigured()).toBe(false);
    process.env.OLLASTACK_API_KEY = "test-key-placeholder";
    expect(authEmailProviderConfigured()).toBe(true);
    expect(authDevFallbackEnabled()).toBe(false);
    process.env.AUTH_DEV_FALLBACK = "1";
    expect(authDevFallbackEnabled()).toBe(true);
  });
});

[
  ["sign-in OTP (Ollastack)", OllastackOTP],
  ["sign-in OTP (alias)", ResendOTP],
  ["signup verification (Ollastack)", OllastackOTPVerify],
  ["signup verification (alias)", ResendOTPVerify],
  ["password reset (Ollastack)", OllastackOTPReset],
  ["password reset (alias)", ResendOTPReset],
].forEach(([label, provider]) => {
  const send = (provider as { sendVerificationRequest: unknown })
    .sendVerificationRequest as (
    args: { identifier: string; token: string },
    ctx?: unknown,
  ) => Promise<void>;
  const token = `${label}`.includes("password") ? "246813" : "246810";
  const EMAIL = "otp-test-user@myos.test";

  describe(`${label} delivery policy`, () => {
    test("no provider + no dev flag: fails closed with an operational error, no code in any console output", async () => {
      setEnv("OLLASTACK_API_KEY", undefined);
      setEnv("AUTH_DEV_FALLBACK", undefined);
      setEnv("SMTP_HOST", undefined);
      const capture = {
        lines: [] as string[],
        tokenSeen: false,
        token,
      } as ConsoleCapture;
      spyConsole(capture);
      await expect(
        send({ identifier: EMAIL, token }, PROVIDER_CTX),
      ).rejects.toThrow(/not configured|deliver/i);
      expect(capture.tokenSeen).toBe(false);
      expect(
        capture.lines.some((l) => l.includes(token)),
        "generated code must not reach any console output",
      ).toBe(false);
    });

    test("no provider + AUTH_DEV_FALLBACK=1: code logged server-side (dev convenience), no throw", async () => {
      setEnv("OLLASTACK_API_KEY", undefined);
      setEnv("AUTH_DEV_FALLBACK", "1");
      const capture = {
        lines: [] as string[],
        tokenSeen: false,
        token,
      } as ConsoleCapture;
      spyConsole(capture);
      await expect(
        send({ identifier: EMAIL, token }, PROVIDER_CTX),
      ).resolves.toBeUndefined();
      expect(capture.tokenSeen).toBe(true); // explicit dev fallback logs to server console
    });

    test("provider configured + delivery success: code never in console output", async () => {
      setEnv("OLLASTACK_API_KEY", "test-key-placeholder");
      setEnv("AUTH_DEV_FALLBACK", undefined);
      const seen: Array<Record<string, unknown>> = [];
      const procCtx = {
        runAction: async (_ref: unknown, args: unknown) => {
          seen.push(args as Record<string, unknown>);
        },
      };
      const capture = {
        lines: [] as string[],
        tokenSeen: false,
        token,
      } as ConsoleCapture;
      spyConsole(capture);
      await expect(
        send({ identifier: EMAIL, token }, procCtx),
      ).resolves.toBeUndefined();
      expect(capture.tokenSeen).toBe(false);
      expect(seen.length).toBeGreaterThanOrEqual(1);
      // The delivered email body does include the code — that is the trusted channel.
    });

    test("provider configured + delivery rejected + dev off: throws sanitized error; token in no console output", async () => {
      setEnv("OLLASTACK_API_KEY", "test-key-placeholder");
      setEnv("AUTH_DEV_FALLBACK", undefined);
      const procCtx = {
        runAction: async () => {
          throw new Error("Ollastack send failed (400): Recipient not verified");
        },
      };
      const capture = {
        lines: [] as string[],
        tokenSeen: false,
        token,
      } as ConsoleCapture;
      spyConsole(capture);
      await expect(send({ identifier: EMAIL, token }, procCtx)).rejects.toThrow(
        /Unable to deliver/i,
      );
      expect(capture.tokenSeen).toBe(false);
    });

    test("provider configured + delivery rejected + AUTH_DEV_FALLBACK=1: tolerated (sandbox/dev), token not logged", async () => {
      setEnv("OLLASTACK_API_KEY", "test-key-placeholder");
      setEnv("AUTH_DEV_FALLBACK", "1");
      const procCtx = {
        runAction: async () => {
          throw new Error("Ollastack send failed (400): Recipient not verified");
        },
      };
      const capture = {
        lines: [] as string[],
        tokenSeen: false,
        token,
      } as ConsoleCapture;
      spyConsole(capture);
      await expect(
        send({ identifier: EMAIL, token }, procCtx),
      ).resolves.toBeUndefined();
      expect(capture.tokenSeen).toBe(false);
    });

    test("redaction semantics: scheduler fallback path also never logs the code", async () => {
      setEnv("OLLASTACK_API_KEY", "test-key-placeholder");
      setEnv("AUTH_DEV_FALLBACK", undefined);
      const schedCtx = {
        scheduler: {
          runAfter: async () => ({}),
        },
      };
      const capture = {
        lines: [] as string[],
        tokenSeen: false,
        token,
      } as ConsoleCapture;
      spyConsole(capture);
      await expect(
        send({ identifier: EMAIL, token }, schedCtx),
      ).resolves.toBeUndefined();
      expect(capture.tokenSeen).toBe(false);
    });
  });
});

describe("email.ts fallback logging redaction", () => {
  test("missing OLLASTACK_API_KEY: fallback log contains recipient/subject but NOT the body (may contain codes)", async () => {
    setEnv("OLLASTACK_API_KEY", undefined);
    const capture = {
      lines: [] as string[],
      tokenSeen: false,
      token: "776655",
    } as ConsoleCapture;
    spyConsole(capture);
    const fakeCtx = { runMutation: async () => {} };
    // internalAction object exposes ._handler at runtime
    const handler = (sendEmailAction as unknown as { _handler: unknown })
      ._handler as (
      ctx: unknown,
      args: {
        to: string;
        subject: string;
        text: string;
        notifyUserId?: unknown;
        workspaceId?: unknown;
        context?: string;
      },
    ) => Promise<void>;
    await handler(fakeCtx, {
      to: "otp-test-user@myos.test",
      subject: "Your sign-in code",
      text: "Your sign-in code is: 776655",
    });
    expect(capture.tokenSeen).toBe(false);
    expect(capture.lines.join("\n")).toContain("otp-test-user@myos.test");
    expect(capture.lines.join("\n")).not.toContain("776655");
  });

  test("ENV_KEYS are covered by the backup helper (test hygiene)", () => {
    expect(ENV_KEYS).toEqual(
      expect.arrayContaining(["OLLASTACK_API_KEY", "AUTH_DEV_FALLBACK"]),
    );
  });
});

