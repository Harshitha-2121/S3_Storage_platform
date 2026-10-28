// Full live flow: OTP login via tunnel -> dashboard pages -> console/network capture
// Code retrieval channel: VM backend /api/action logLines (which also documents the OTP leak).
const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://yellow-showers-initiative-advisors.trycloudflare.com";
const CONVEX_DIRECT = process.env.CONVEX_DIRECT || "http://10.70.70.47:3210";
const ts = Date.now();
const EMAIL = `qa-flow-${ts}@myos.test`;
const PW = "QaFlow#2026x";
const errs = [], failed = [], wsEps = [], authReqs = [];

async function getCodeFromLogs(email, label) {
  // Parallel signIn call forces a fresh code; read it from logLines.
  const r = await fetch(`${CONVEX_DIRECT}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "auth:signIn",
      args: { provider: "resend-otp", params: { email } },
      format: "json",
    }),
  });
  const j = await r.json();
  const lines = j?.logLines || [];
  const found = lines.filter((l) => l.includes(email)).join(" || ");
  console.log(`[logs] fetch for ${email}: ${found.slice(0, 300) || "(no matching log lines)"}`);
  // label forms: [auth] OTP for <email>: 123456
  let m = found.match(/OTP for .*?([0-9]{6,8})/);
  if (label === "verify") m = found.match(/email verification code for .*?:\s*([0-9]{6,8})/);
  if (label === "reset") m = found.match(/password reset code for .*?:\s*([0-9]{6,8})/);
  return m ? m[1] : null;
}

const step = async (n, f) => {
  try { const d = await f(); console.log("PASS  " + n + (d ? " — " + d : "")); return d; }
  catch (e) { console.log("FAIL  " + n + " — " + (e.message || e).split("\n")[0]); throw e; }
};

(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(`[${m.type()}] ${m.text().slice(0, 220)}`); });
  page.on("websocket", (w) => wsEps.push(w.url()));
  page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url().slice(0, 150)} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.url().includes("api/auth") || r.url().includes("convex")) authReqs.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`); });

  // freeze the parallel channel runner so we can trigger on demand
  let last = null;
  const fetchCode = async (label) => { last = await getCodeFromLogs(EMAIL, label); return last; };

  await step("goto login", async () => {
    await page.goto(BASE + "/en/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
  });

  let trigger = false; // after clicking Send code, VC will release gate
  const codePromise = new Promise(async (res) => { setInterval(async () => { if (trigger && !last) { await fetchCode("otp").then(res).catch(() => {}); } }, 1200); });

  await step("OTP send", async () => {
    await page.fill('input[type="email"]', EMAIL);
    await page.getByRole("button", { name: "Send code" }).click();
    trigger = true;
  });

  await step("OTP verify with retrieved code", async () => {
    const code = await Promise.race([codePromise, new Promise((r) => setTimeout(() => r("TIMEOUT"), 20000))]);
    console.log("[code]", code);
    if (!code || code === "TIMEOUT") throw new Error("no OTP code from logLines channel");
    await page.waitForSelector('input[placeholder="123456"], input[placeholder*="code" i]', { timeout: 15000 });
    await page.locator('input[placeholder="123456"], input[placeholder*="code" i]').first().fill(code);
    const verifyBtns = await page.getByRole("button", { name: /verify|continue|check/i }).allTextContents();
    console.log("[verify buttons]", JSON.stringify(verifyBtns));
    await page.locator("button", { hasText: /verify|continue|check/i }).first().click();
    await page.waitForTimeout(4500);
    console.log("[url after verify]", page.url());
  });

  // onboarding if present
  const onboarding = /onboarding/.test(page.url());
  if (onboarding) {
    await step("onboarding username", async () => {
      await page.fill('input[placeholder*="Username"]', `qa${String(ts).slice(-7)}`);
      await page.getByRole("button", { name: /continue|create/i }).first().click();
      await page.waitForTimeout(5000);
      console.log("[url after onboarding]", page.url());
    });
  }

  await step("dashboard reachable", async () => {
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    const url = page.url();
    console.log("[dashboard url]", url);
    if (/login|onboarding/.test(url)) throw new Error("bounced back to " + url);
    return url;
  });

  const pages = ["/en/buckets", "/en/credentials", "/en/platform", "/en/jobs", "/en/files", "/en/settings"];
  for (const p of pages) {
    await step("nav " + p, async () => {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
      const url = page.url();
      if (/login/.test(url)) throw new Error("redirected to login: " + url);
      console.log("[nav]", p, "->", url);
      const heading = (await page.locator("h1,h2").first().textContent().catch(() => "")) || "";
      return heading.slice(0, 40);
    });
  }

  console.log("\n===== DIAGNOSTICS =====");
  console.log("emails/requests seen on convex:", JSON.stringify(authReqs.slice(0, 40), null, 1));
  console.log("\nWS endpoints:", JSON.stringify(wsEps.slice(0, 20), null, 1));
  console.log("\nFailed requests:", JSON.stringify(failed.slice(0, 30), null, 1));
  console.log("\nConsole errors/warnings:", JSON.stringify(errs.slice(0, 40), null, 1));
  await page.screenshot({ path: "final-state.png", fullPage: true });
  await b.close();
})().catch((e) => { console.error("FATAL", e.message || e); process.exit(1); });
