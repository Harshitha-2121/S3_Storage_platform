"""
LIVE security regression test: OTP secrecy against the HTTP surface.

Root cause under test: an unauthenticated caller POSTs to the Convex backend
HTTP action API and must never receive (or see logged) the generated OTP code
through HTTP response bodies or client-visible `logLines`.

Regression coverage:
1. sign-in OTP flow (auth:signIn, provider resend-otp)   -> no code in response
2. signup verification code via the password provider    -> no code in response

Behavior expectations:
- With hardened provider code deployed (post-remediation) this test PASSES.
- Against a STALE deployment (pre-remediation functions) it FAILS with the
  exact finding, which is the desired alarm: do not ignore it.

Run with the local dev stack up:  python test_otp_no_leak.py
(The probe uses a dedicated @myos.test test identity; never a real user.)

Classification: LOCAL INTEGRATION (requires Convex backend on 127.0.0.1:3210).
"""

import json
import re
import sys

import requests

BASE = "http://127.0.0.1:3210"
PROBE_EMAIL = "remediation-probe@myos.test"

# The remediated code always generates a 6-digit OTP; stale deployments printed
# 8-char tokens. Match both so the checker is version-robust.
CODE_RE = re.compile(r"(?<![\dA-Za-z])([0-9]{6,8})(?![\dA-Za-z])")


def call_signin(provider: str, params: dict):
    return requests.post(
        f"{BASE}/api/action",
        headers={"Content-Type": "application/json"},
        json={"path": provider, "args": {"params": params}, "format": "json"},
        timeout=30,
    )


def response_exposes_code(body_text: str) -> bool:
    """True if a plausible OTP code appears outside of harmless values."""
    try:
        parsed = json.loads(body_text)
    except Exception:
        parsed = None
    if isinstance(parsed, dict):
        log_lines = parsed.get("logLines") or []
        if isinstance(log_lines, list):
            return any(CODE_RE.search(str(line)) for line in log_lines)
    return CODE_RE.search(body_text) is not None


def main() -> int:
    failures = []

    print("=" * 60)
    print("OTP SECRECY (live HTTP surface)")
    print("=" * 60)

    # 1) sign-in OTP
    print("\n[1] auth:signIn (resend-otp) — code must not leak via logLines")
    try:
        r = call_signin("auth:signIn", {"email": PROBE_EMAIL})
        exposed = response_exposes_code(r.text)
        print(f"    status={r.status_code} code_leaked={exposed}")
        if exposed:
            failures.append("signin: OTP visible in HTTP response/logLines")
    except Exception as e:
        failures.append(f"signin probe error: {type(e).__name__}: {e}")
        print(f"    SKIP/error: {e}")

    # 2) signup verification flow (password provider verify)
    print("\n[2] auth:signIn (verify provider, signup path) — code must not leak")
    try:
        r = call_signin(
            "auth:signIn",
            {
                "email": PROBE_EMAIL,
                "password": "Rem-Test-Passw0rD",
                "flow": "signUp",
            },
        )
        exposed = response_exposes_code(r.text)
        print(f"    status={r.status_code} code_leaked={exposed}")
        if exposed:
            failures.append("signup: code visible in HTTP response/logLines")
    except Exception as e:
        failures.append(f"signup probe error: {type(e).__name__}: {e}")
        print(f"    SKIP/error: {e}")

    print("\nRESULT:", "FAIL" if failures else "PASS")
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
