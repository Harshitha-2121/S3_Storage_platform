"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@v1/ui/button";
import { useState } from "react";

type Mode = "signIn" | "signUp" | "verify" | "forgot" | "reset";
const input =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

// Module-level (stable identity) — defining this inside AuthForm remounts inputs every
// keystroke, which steals focus after one character.
function Shell({
  onSubmit,
  cta,
  pending,
  error,
  info,
  children,
}: {
  onSubmit: (e: React.FormEvent) => void;
  cta: string;
  pending: boolean;
  error: string | null;
  info: string | null;
  children: React.ReactNode;
}) {
  return (
    <form className="flex w-72 flex-col gap-3" onSubmit={onSubmit}>
      {children}
      <Button type="submit" disabled={pending} className="font-mono">
        {pending ? "…" : cta}
      </Button>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {info && <p className="text-xs text-muted-foreground">{info}</p>}
    </form>
  );
}

const Switch = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="text-xs text-muted-foreground underline" onClick={onClick}>
    {label}
  </button>
);

export function AuthForm() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const go = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await fn();
    } catch (err) {
      const data = (err as { data?: unknown })?.data;
      setError(typeof data === "string" ? data : (err as Error)?.message || "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  const submitSignIn = go(async () => {
    const res = await signIn("password", { email, password, flow: "signIn" });
    if (res && "signingIn" in res && res.signingIn) {
      window.location.href = "/";
    }
  });
  const submitSignUp = go(async () => {
    await signIn("password", { email, password, flow: "signUp" });
    setInfo("Enter the verification code (check server logs while email is in dev mode).");
    setMode("verify");
  });
  const submitVerify = go(async () => {
    const res = await signIn("password", { email, code, flow: "email-verification" });
    if (!res || (typeof res === "object" && "signingIn" in res && res.signingIn) || res === null) {
      window.location.href = "/";
    }
  });
  const submitForgot = go(async () => {
    await signIn("password", { email, flow: "reset" });
    setInfo("Enter the reset code (check server logs) and a new password.");
    setMode("reset");
  });
  const submitReset = go(async () => {
    const res = await signIn("password", { email, code, newPassword, flow: "reset-verification" });
    if (res && "signingIn" in res && res.signingIn) {
      window.location.href = "/";
    }
  });
  const switchTo = (m: Mode) => { setError(null); setInfo(null); setMode(m); };

  const shellProps = { pending, error, info };

  return (
    <div className="flex flex-col items-center gap-3">
      {mode === "signIn" && (
        <>
          <Shell onSubmit={submitSignIn} cta="Sign in" {...shellProps}>
            <input className={input} type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={input} type="password" placeholder="Password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Shell>
          <div className="flex w-72 justify-between">
            <Switch label="Create account" onClick={() => switchTo("signUp")} />
            <Switch label="Forgot password?" onClick={() => switchTo("forgot")} />
          </div>
        </>
      )}
      {mode === "signUp" && (
        <>
          <Shell onSubmit={submitSignUp} cta="Create account" {...shellProps}>
            <input className={input} type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={input} type="password" placeholder="Password (8+, upper, lower, number)" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Shell>
          <Switch label="Have an account? Sign in" onClick={() => switchTo("signIn")} />
        </>
      )}
      {mode === "verify" && (
        <Shell onSubmit={submitVerify} cta="Verify email" {...shellProps}>
          <p className="text-xs text-muted-foreground">Code sent to {email}</p>
          <input className={input} inputMode="numeric" placeholder="Verification code" required value={code} onChange={(e) => setCode(e.target.value)} />
        </Shell>
      )}
      {mode === "forgot" && (
        <>
          <Shell onSubmit={submitForgot} cta="Send reset code" {...shellProps}>
            <input className={input} type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Shell>
          <Switch label="Back to sign in" onClick={() => switchTo("signIn")} />
        </>
      )}
      {mode === "reset" && (
        <Shell onSubmit={submitReset} cta="Set new password" {...shellProps}>
          <p className="text-xs text-muted-foreground">Reset code for {email}</p>
          <input className={input} inputMode="numeric" placeholder="Reset code" required value={code} onChange={(e) => setCode(e.target.value)} />
          <input className={input} type="password" placeholder="New password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Shell>
      )}

      <div className="flex w-72 items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
      </div>
      <Button
        variant="outline"
        className="w-72 font-mono"
        onClick={async () => {
          setError(null);
          setPending(true);
          try {
            await signIn("google");
          } catch (err) {
            const data = (err as { data?: unknown })?.data;
            setError(
              typeof data === "string"
                ? data
                : (err as Error)?.message ||
                    "Google sign-in failed. Check AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET and the authorized redirect URI in Google Cloud Console.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        Continue with Google
      </Button>
    </div>
  );
}
