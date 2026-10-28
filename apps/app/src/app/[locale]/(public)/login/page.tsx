"use client";

import { Logo } from "@/components/logo";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Tab = "user" | "admin";
type View =
  | "otp"
  | "otp-verify"
  | "signup"
  | "verify"
  | "forgot"
  | "reset"
  | "admin-signin";

const inputCls =
  "h-11 w-full min-w-0 rounded-lg border border-[#303038] bg-[#131317] px-3.5 text-sm text-white placeholder:text-[#78849a] outline-none transition-colors focus-visible:border-[#899cbb] focus-visible:ring-2 focus-visible:ring-[#899cbb]/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const buttonCls =
  "h-11 w-full rounded-lg border border-[#303038] bg-black px-3.5 text-sm font-medium text-white outline-none transition-colors hover:border-[#585862] hover:bg-[#19191e] focus-visible:ring-2 focus-visible:ring-[#899cbb] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const linkCls =
  "rounded-sm text-[#a6b2c6] underline decoration-[#596273] underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#899cbb] motion-reduce:transition-none";

export default function Page() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("user");
  const [view, setView] = useState<View>("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [resendCooldown, setResendCooldown] = useState(0);

  const switchTab = (t: Tab) => {
    if (pending || t === tab) return;
    setTab(t);
    setEmail("");
    setPassword("");
    setCode("");
    setError(null);
    setInfo(null);
    setView(t === "user" ? "otp" : "admin-signin");
  };

  const run = async (fn: () => Promise<void>, context?: "signup" | "verify" | "otp" | "general") => {
    setError(null);
    setPending(true);
    try {
      await fn();
    } catch (err) {
      const data = (err as { data?: unknown })?.data;
      const raw = (err as Error)?.message || "Something went wrong.";
      const errorText = typeof data === "string" ? data : raw;

      if (/already exists/i.test(errorText)) {
        setError("An account with this email already exists. Please log in or reset your password.");
      } else if (/Password must be/i.test(errorText) || /Invalid password/i.test(errorText)) {
        setError("Password must be at least 8 characters and include uppercase, lowercase, and a number.");
      } else if (/reading 'redirect'/.test(errorText)) {
        // @convex-dev/auth throws or returns a state whose client crashes reading .redirect
        if (context === "signup") {
          // If this happens during initial signup, it's not a bad OTP code!
          setError("Could not complete registration. Please check your details and try again.");
        } else if (context === "otp") {
          // Benign @convex-dev/auth Next.js client artifact during sendCode: proceed to verify step
          setInfo(`Code sent to ${normalizedEmail}`);
          setView("otp-verify");
          return;
        } else {
          setError("Invalid or expired code. Send a new code below and try again.");
        }
      } else if (/Could not verify code|Invalid code|Invalid verification code/i.test(errorText)) {
        setError("The verification code is incorrect or has expired. Please request a new code.");
      } else if (/Too many failed/i.test(errorText) || /rate limit/i.test(errorText)) {
        setError("Too many attempts. Please wait a few minutes before trying again.");
      } else if (/Failed to fetch|NetworkError|Network request failed/i.test(errorText)) {
        setError("Network error. Please check your internet connection and verify the server is running.");
      } else {
        setError(errorText || "An unexpected error occurred. Please try again.");
      }
    } finally {
      setPending(false);
    }
  };

  const goHome = (res: unknown) => {
    if (
      !res ||
      res === null ||
      (typeof res === "object" && "signingIn" in res)
    ) {
      router.push("/");
    }
  };

  const normalizedEmail = email.trim().toLowerCase();

  const sendCode = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      try {
        await signIn("ollastack-otp", { email: normalizedEmail });
      } catch (err: unknown) {
        const msg = (err as Error)?.message || "";
        if (/reading 'redirect'/i.test(msg)) {
          // Benign @convex-dev/auth Next.js client artifact during sendCode
        } else {
          throw err;
        }
      }
      setInfo(`Code sent to ${normalizedEmail}`);
      setView("otp-verify");
    }, "otp");

  const verifyCode = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      const res = await signIn("ollastack-otp", { email: normalizedEmail, code: code.trim() });
      goHome(res);
    }, "verify");

  const submitSignUp = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      await signIn("password", { email: normalizedEmail, password, flow: "signUp" });
      setInfo(`A verification code has been sent to ${normalizedEmail}. Please check your inbox.`);
      setView("verify");
      startResendCooldown();
    }, "signup");

  const submitVerify = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      const res = await signIn("password", {
        email: normalizedEmail,
        code: code.trim(),
        flow: "email-verification",
      });
      goHome(res);
    }, "verify");

  const startResendCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const resendSignupCode = () =>
    run(async () => {
      if (resendCooldown > 0) return;
      if (!password) {
        setError("Password is required to request a new verification code.");
        return;
      }
      await signIn("password", { email: normalizedEmail, password, flow: "signUp" });
      setCode("");
      setInfo(`A new verification code was sent to ${normalizedEmail}. It expires in 15 minutes.`);
      startResendCooldown();
    }, "signup");

  const submitSignIn = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      const res = await signIn("password", { email: normalizedEmail, password, flow: "signIn" });
      goHome(res);
    }, "general");

  const submitForgot = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      await signIn("password", { email: normalizedEmail, flow: "reset" });
      setInfo("Enter the reset code sent to your email and a new password.");
      setView("reset");
      startResendCooldown();
    }, "general");

  const submitReset = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      const res = await signIn("password", {
        email,
        code,
        newPassword,
        flow: "reset-verification",
      });
      goHome(res);
    });

  const backToMain = () => {
    setError(null);
    setInfo(null);
    setView(tab === "user" ? "otp" : "admin-signin");
  };

  const showTabs = view === "otp" || view === "admin-signin";

  return (
    <main className="flex min-h-screen min-h-[100dvh] w-full items-center justify-center bg-black px-4 py-8 sm:px-6">
      <section aria-label="Sign in" className="w-full max-w-[380px] rounded-2xl border border-[#292a30] bg-[#0c0c0f] px-6 py-8 shadow-[0_20px_65px_rgba(0,0,0,0.3)] sm:px-8 sm:py-9">
        <div className="flex justify-center">
          <div className="rounded-full border border-white/20 bg-gradient-to-br from-white/20 via-[#343640] to-black p-[3px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_7px_18px_rgba(0,0,0,0.5)]">
            <Logo size={52} />
          </div>
        </div>

        {showTabs && (
          <div
            role="tablist"
            aria-label="Login type"
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || pending) return;
              e.preventDefault();
              const next: Tab = e.key === "Home" ? "user" : e.key === "End" ? "admin" : tab === "user" ? "admin" : "user";
              switchTab(next);
              document.getElementById(`login-tab-${next}`)?.focus();
            }}
            className="mt-7 grid grid-cols-2 gap-1 rounded-lg border border-[#25262c] bg-[#17171b] p-1 text-sm"
          >
            <button
              id="login-tab-user"
              type="button"
              role="tab"
              aria-selected={tab === "user"}
              aria-controls="login-panel-user"
              tabIndex={tab === "user" ? 0 : -1}
              disabled={pending}
              onClick={() => switchTab("user")}
              className={`min-h-10 rounded-md px-2 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#899cbb] disabled:cursor-not-allowed motion-reduce:transition-none ${
                tab === "user"
                  ? "border border-[#34343c] bg-[#08080a] text-white shadow-sm"
                  : "border border-transparent text-[#9ba5b6] hover:text-white"
              }`}
            >
              User Login
            </button>
            <button
              id="login-tab-admin"
              type="button"
              role="tab"
              aria-selected={tab === "admin"}
              aria-controls="login-panel-admin"
              tabIndex={tab === "admin" ? 0 : -1}
              disabled={pending}
              onClick={() => switchTab("admin")}
              className={`min-h-10 rounded-md px-2 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#899cbb] disabled:cursor-not-allowed motion-reduce:transition-none ${
                tab === "admin"
                  ? "border border-[#34343c] bg-[#08080a] text-white shadow-sm"
                  : "border border-transparent text-[#9ba5b6] hover:text-white"
              }`}
            >
              Admin Login
            </button>
          </div>
        )}

        {view === "otp" && (
          <div id="login-panel-user" role="tabpanel" aria-labelledby="login-tab-user" className="mt-7">
            <h1 className="text-center text-xl font-semibold tracking-tight text-white">
              User Portal OTP
            </h1>
            <p className="mt-2 text-center text-sm text-[#9aa9bc]">
              Enter your email to receive a code
            </p>
            <form className="mt-6 space-y-3" onSubmit={sendCode}>
              <label htmlFor="otp-email" className="sr-only">
                Email address
              </label>
              <input
                id="otp-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                aria-describedby={error ? "user-login-error" : undefined}
                aria-invalid={!!error}
                className={inputCls}
              />
              <button type="submit" disabled={pending} aria-busy={pending} className={buttonCls}>
                {pending ? "Sending…" : "Send code"}
              </button>
            </form>
            {info && (
              <p role="status" className="mt-3 text-center text-xs text-emerald-300">{info}</p>
            )}
            {error && (
              <p id="user-login-error" role="alert" className="mt-3 text-center text-xs text-red-400">
                {error}
              </p>
            )}
            <p className="mt-6 text-center text-xs text-[#9aa9bc]">
              New here?{" "}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setView("signup");
                }}
                className={linkCls}
              >
                Create an account
              </button>
            </p>
          </div>
        )}

        {view === "otp-verify" && (
          <div className="mt-6">
            <h1 className="text-center text-lg font-semibold text-white">
              Enter code
            </h1>
            <p className="mt-1 text-center text-sm text-neutral-400">
              Code sent to <span className="font-mono">{email}</span>
            </p>
            <form className="mt-5 space-y-3" onSubmit={verifyCode}>
              <label htmlFor="otp-code" className="sr-only">
                Verification code
              </label>
              <input
                id="otp-code"
                inputMode="numeric"
                required
                autoComplete="one-time-code"
                placeholder="8-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={pending}
                className={inputCls}
              />
              <button type="submit" disabled={pending} className={buttonCls}>
                {pending ? "Verifying…" : "Verify"}
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-3 text-center text-xs text-red-400">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={backToMain}
              className="mt-4 w-full text-center text-xs text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
            >
              Use a different email
            </button>
          </div>
        )}

        {view === "signup" && (
          <div className="mt-6">
            <h1 className="text-center text-lg font-semibold text-white">
              Create an account
            </h1>
            <p className="mt-1 text-center text-sm text-neutral-400">
              Password needs 8+ characters, upper, lower and a number
            </p>
            <form className="mt-5 space-y-3" onSubmit={submitSignUp}>
              <label htmlFor="signup-email" className="sr-only">
                Email address
              </label>
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                className={inputCls}
              />
              <label htmlFor="signup-password" className="sr-only">
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
                className={inputCls}
              />
              <button type="submit" disabled={pending} className={buttonCls}>
                {pending ? "Creating…" : "Create account"}
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-3 text-center text-xs text-red-400">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={backToMain}
              className="mt-4 w-full text-center text-xs text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
            >
              Back to login
            </button>
          </div>
        )}

        {view === "verify" && (
          <div className="mt-6">
            <h1 className="text-center text-lg font-semibold text-white">
              Verify email
            </h1>
            <p className="mt-1 text-center text-sm text-neutral-400">
              Code sent to <span className="font-mono">{email}</span>
            </p>
            <form className="mt-5 space-y-3" onSubmit={submitVerify}>
              <label htmlFor="verify-code" className="sr-only">
                Verification code
              </label>
              <input
                id="verify-code"
                inputMode="numeric"
                required
                autoComplete="one-time-code"
                placeholder="Verification code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={pending}
                className={inputCls}
              />
              <button type="submit" disabled={pending} className={buttonCls}>
                {pending ? "Verifying…" : "Verify email"}
              </button>
            </form>
            <p className="mt-3 text-center text-xs text-neutral-400">
              No code yet, or expired?{" "}
              <button
                type="button"
                disabled={pending || resendCooldown > 0}
                onClick={resendSignupCode}
                className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200 disabled:opacity-60"
              >
                {pending
                  ? "Sending…"
                  : resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : "Send a new code"}
              </button>
            </p>
            {info && (
              <p className="mt-3 text-center text-xs text-emerald-400">{info}</p>
            )}
            {error && (
              <p role="alert" className="mt-3 text-center text-xs text-red-400">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={backToMain}
              className="mt-4 w-full text-center text-xs text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
            >
              Back to login
            </button>
          </div>
        )}

        {view === "admin-signin" && (
          <div id="login-panel-admin" role="tabpanel" aria-labelledby="login-tab-admin" className="mt-7">
            <h1 className="text-center text-xl font-semibold tracking-tight text-white">
              Admin Portal
            </h1>
            <p className="mt-2 text-center text-sm text-[#9aa9bc]">
              Sign in with administrator credentials
            </p>
            <form className="mt-6 space-y-3" onSubmit={submitSignIn}>
              <label htmlFor="admin-email" className="sr-only">
                Email address
              </label>
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                aria-describedby={error ? "admin-login-error" : undefined}
                aria-invalid={!!error}
                className={inputCls}
              />
              <label htmlFor="admin-password" className="sr-only">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
                aria-describedby={error ? "admin-login-error" : undefined}
                aria-invalid={!!error}
                className={inputCls}
              />
              <button type="submit" disabled={pending} aria-busy={pending} className={buttonCls}>
                {pending ? "Signing in…" : "Sign in"}
              </button>
            </form>
            {error && (
              <p id="admin-login-error" role="alert" className="mt-3 text-center text-xs text-red-400">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInfo(null);
                setView("forgot");
              }}
              className={`mt-5 block w-full text-center text-xs ${linkCls}`}
            >
              Forgot password?
            </button>
          </div>
        )}

        {view === "forgot" && (
          <div className="mt-6">
            <h1 className="text-center text-lg font-semibold text-white">
              Reset password
            </h1>
            <p className="mt-1 text-center text-sm text-neutral-400">
              Enter your email to receive a reset code
            </p>
            <form className="mt-5 space-y-3" onSubmit={submitForgot}>
              <label htmlFor="forgot-email" className="sr-only">
                Email address
              </label>
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                className={inputCls}
              />
              <button type="submit" disabled={pending} className={buttonCls}>
                {pending ? "Sending…" : "Send reset code"}
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-3 text-center text-xs text-red-400">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={backToMain}
              className="mt-4 w-full text-center text-xs text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
            >
              Back to login
            </button>
          </div>
        )}

        {view === "reset" && (
          <div className="mt-6">
            <h1 className="text-center text-lg font-semibold text-white">
              Set new password
            </h1>
            <p className="mt-1 text-center text-sm text-neutral-400">
              Reset code for <span className="font-mono">{email}</span>
            </p>
            <form className="mt-5 space-y-3" onSubmit={submitReset}>
              <label htmlFor="reset-code" className="sr-only">
                Reset code
              </label>
              <input
                id="reset-code"
                inputMode="numeric"
                required
                autoComplete="one-time-code"
                placeholder="Reset code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={pending}
                className={inputCls}
              />
              <label htmlFor="reset-password" className="sr-only">
                New password
              </label>
              <input
                id="reset-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={pending}
                className={inputCls}
              />
              <button type="submit" disabled={pending} className={buttonCls}>
                {pending ? "Saving…" : "Set new password"}
              </button>
            </form>
            {info && (
              <p className="mt-3 text-center text-xs text-neutral-400">{info}</p>
            )}
            {error && (
              <p role="alert" className="mt-3 text-center text-xs text-red-400">
                {error}
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
