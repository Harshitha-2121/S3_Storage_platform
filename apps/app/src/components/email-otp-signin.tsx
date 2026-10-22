"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@v1/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring";

export function EmailOtpSignin() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === "signIn") {
    return (
      <form
        className="flex flex-col gap-3 w-64"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const fd = new FormData(e.currentTarget);
          setPending(true);
          void signIn("resend-otp", fd)
            .then(() => setStep({ email: fd.get("email") as string }))
            .catch((err) => {
              const msg =
                (err as { data?: unknown })?.data ??
                (err as Error)?.message ??
                "";
              setError(
                typeof msg === "string" && msg
                  ? msg
                  : "Could not send code. Is the backend running? Check Convex logs for the OTP code.",
              );
            })
            .finally(() => setPending(false));
        }}
      >
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className={inputCls}
        />
        <Button type="submit" variant="outline" className="font-mono" disabled={pending}>
          {pending ? "Sending…" : "Send code"}
        </Button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 w-64"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        setPending(true);
        try {
          const res = await signIn("resend-otp", fd);
          if (!res || (typeof res === "object" && "signingIn" in res && res.signingIn) || res === null) {
            window.location.href = "/";
            return;
          }
          window.location.href = "/";
        } catch (err) {
          const msg =
            (err as { data?: unknown })?.data ??
            (err as Error)?.message ??
            "";
          setError(
            typeof msg === "string" && msg
              ? msg
              : "Invalid or expired code. Please check your OTP and try again.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        Code sent to <span className="font-mono">{step.email}</span>
      </p>
      <input
        name="code"
        type="text"
        inputMode="numeric"
        required
        placeholder="8-digit code"
        className={inputCls}
      />
      <input name="email" value={step.email} type="hidden" />
      <Button type="submit" className="font-mono" disabled={pending}>
        {pending ? "Verifying…" : "Continue"}
      </Button>
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setStep("signIn")}
      >
        Use a different email
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
