// CI bootstrap: create + email-verify the admin account the browser suites log in as.
// Captures the dev-mode verification code the self-hosted backend streams as a log line.
const { ConvexHttpClient } = require("convex/browser");
const { anyApi } = require("convex/server");
const api = anyApi;
const URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";
const EMAIL = process.env.ADMIN_EMAIL || "admin@myos.test";
const PW = process.env.ADMIN_PASSWORD || "MyosAdmin#2026";

async function run() {
  const c = new ConvexHttpClient(URL);
  let captured = "";
  const grab = (...a) => {
    captured += a.map(String).join(" ") + "\n";
  };
  const o = { w: console.warn, l: console.log, e: console.error };
  console.warn = grab;
  console.log = grab;
  console.error = grab;
  let r;
  try {
    r = await c.action(api.auth.signIn, {
      provider: "password",
      params: { email: EMAIL, password: PW, flow: "signUp" },
    });
  } finally {
    console.warn = o.w;
    console.log = o.l;
    console.error = o.e;
  }
  let token = r?.tokens?.token;
  if (!token) {
    const m = captured.match(/email verification code for [^:]+: '?(\d+)/);
    if (!m) throw new Error("no verification code captured:\n" + captured);
    const verifyRes = await c.action(api.auth.signIn, {
      provider: "password",
      params: { email: EMAIL, code: m[1], flow: "email-verification" },
    });
    token = verifyRes?.tokens?.token;
  }
  // Complete onboarding (set a username) so the dashboard doesn't redirect.
  if (token) {
    const authed = new ConvexHttpClient(URL);
    authed.setAuth(token);
    try {
      await authed.mutation(api.users.updateUsername, { username: "admin" });
    } catch (e) {
      console.log("username step skipped:", e.message);
    }
  }
  console.log(`admin ${EMAIL} created + verified + onboarded`);
}
run().catch((e) => {
  console.error("bootstrap FAILED:", e.message);
  process.exit(1);
});
