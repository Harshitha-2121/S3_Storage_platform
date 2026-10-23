"use client";

import { Logo } from "@/components/logo";
import { useAuthActions } from "@convex-dev/auth/react";
import { Eye, EyeOff } from "lucide-react";
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
  "w-full rounded-md border border-[#33333a] bg-[#121215] px-3 py-2.5 font-mono text-sm text-neutral-100 placeholder:text-[#6e8bff]/70 outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/60 disabled:opacity-60";
const buttonCls =
  "w-full rounded-md border border-[#33333a] bg-black px-3 py-2.5 text-sm font-medium text-neutral-100 outline-none hover:bg-[#141417] focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60";

export default function Page() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("user");
  const [view, setView] = useState<View>("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [resendCooldown, setResendCooldown] = useState(0);

  const switchTab = (t: Tab) => {
    setTab(t);
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
      } else if (/You can only send testing emails to your own email address/i.test(errorText) || /verify a domain at resend\.com/i.test(errorText)) {
        setError(
          "Email delivery restricted: Using Resend Sandbox mode (onboarding@resend.dev), emails can only be sent to the verified account owner (harshitha.olla@networkershome.com). To send to Temp-Mail or other external addresses, please verify a custom domain at resend.com/domains."
        );
      } else if (/reading 'redirect'/.test(errorText)) {
        // @convex-dev/auth throws or returns a state whose client crashes reading .redirect
        if (context === "signup") {
          setError("Could not complete registration. Please check your details and try again.");
        } else if (context === "otp") {
          setError("Failed to send OTP code. Please verify your email address or check provider configuration.");
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
      await signIn("resend-otp", { email: normalizedEmail });
      setInfo(`Code sent to ${normalizedEmail}`);
      setView("otp-verify");
    }, "otp");

  const verifyCode = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      const res = await signIn("resend-otp", { email: normalizedEmail, code: code.trim() });
      goHome(res);
    }, "verify");

  const submitSignUp = (e: React.FormEvent) =>
    run(async () => {
      e.preventDefault();
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match. Please verify your password confirmation.");
      }
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
    <div className="flex min-h-screen w-full items-center justify-center bg-black px-4 py-10">
      <div className="w-full max-w-[344px] rounded-xl border border-[#26262b] bg-[#0b0b0d] px-8 py-8">
        <div className="flex justify-center">
          <Logo size={60} />
        </div>

        {showTabs && (
          <div
            role="tablist"
            aria-label="Login type"
            className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-[#1b1b1f] p-1 text-sm"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "user"}
              onClick={() => switchTab("user")}
              className={`rounded-md px-3 py-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                tab === "user"
                  ? "bg-black text-white shadow"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              User Login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "admin"}
              onClick={() => switchTab("admin")}
              className={`rounded-md px-3 py-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                tab === "admin"
                  ? "bg-black text-white shadow"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Admin Login
            </button>
          </div>
        )}

        {view === "otp" && (
          <div className="mt-6">
            <h1 className="text-center text-lg font-semibold text-white">
              User Portal OTP
            </h1>
            <p className="mt-1 text-center text-sm text-neutral-400">
              Enter your email to receive a code
            </p>
            <form className="mt-5 space-y-3" onSubmit={sendCode}>
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
                className={inputCls}
              />
              <button type="submit" disabled={pending} className={buttonCls}>
                {pending ? "Sending…" : "Send code"}
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
            <p className="mt-5 text-center text-xs text-neutral-400">
              New here?{" "}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setView("signup");
                }}
                className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
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
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-200 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="relative">
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={pending}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-200 focus:outline-none"
                  aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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

        {(view === "admin-signin") && (
          <div className="mt-6">
            <h1 className="text-center text-lg font-semibold text-white">
              Admin Portal
            </h1>
            <p className="mt-1 text-center text-sm text-neutral-400">
              Sign in with administrator credentials
            </p>
            <form className="mt-5 space-y-3" onSubmit={submitSignIn}>
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
                className={inputCls}
              />
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-200 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button type="submit" disabled={pending} className={buttonCls}>
                {pending ? "Signing in…" : "Sign in"}
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-3 text-center text-xs text-red-400">
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
              className="mt-4 w-full text-center text-xs text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
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
              <div className="relative">
                <input
                  id="reset-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={pending}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-200 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
      </div>
    </div>
  );
}
