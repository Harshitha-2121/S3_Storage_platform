// Full auth E2E over Cloudflare HTTPS: signup+verify, reset, admin regression, google button.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = process.env.E2E_BASE_URL || "https://blue-transmission-clinic-photo.trycloudflare.com";
const SSH = 'ssh -i C:\\Users\\test\\.ssh\\id_ed25519 -o StrictHostKeyChecking=no -o BatchMode=yes root@10.1.30.14';
const ts = Date.now();
const EMAIL = `authtest${ts}@myos.test`, PW = "TestUser#2026", NEWPW = "NewPass#2026";
const errs = [], results = []; let cur = BASE;
const step = async (n, f) => { try { const d = await f(); results.push([true, n, d || ""]); console.log("PASS  " + n + (d ? " — " + d : "")); } catch (e) { results.push([false, n, e.message.split("\n")[0]]); console.log("FAIL  " + n + " — " + e.message.split("\n")[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getCode(label, email) {
  for (let i = 0; i < 25; i++) {
    try {
      const out = execSync(`${SSH} "grep -a '${label} code for ${email}' /tmp/cvxlogs.txt | tail -1"`, { encoding: "utf8" });
      const m = out.match(/code for .*?:\s*(\d{6,8})/);
      if (m) return m[1];
    } catch (_) {}
    await sleep(1500);
  }
  throw new Error(`no ${label} code for ${email}`);
}
(async () => {
  const b = await chromium.launch({ headless: !!process.env.CI, slowMo: process.env.CI ? 0 : 150 });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 850 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(`[${cur}] ${m.text()}`); });

  await step("login page renders AuthForm + Google", async () => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 20000 }); cur = page.url();
    if (!(await page.locator('button:has-text("Continue with Google")').isVisible())) throw new Error("no Google button");
  });

  await step("Sign up (password policy + verify required)", async () => {
    await page.click('button:has-text("Create account")');
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PW);
    await page.click('button:has-text("Create account")');
    await page.waitForSelector('input[placeholder="Verification code"]', { timeout: 15000 });
  });
  await step("Email verification (code from logs)", async () => {
    const code = await getCode("email verification", EMAIL);
    await page.fill('input[placeholder="Verification code"]', code);
    await page.click('button:has-text("Verify email")');
    await page.waitForTimeout(3500);
    return code;
  });
  await step("Onboarding + dashboard (new tenant)", async () => {
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500); cur = page.url();
    if (/onboarding/.test(cur)) { await page.fill('input[placeholder="Username"]', `auth${String(ts).slice(-6)}`); await page.click('button:has-text("Continue")'); await page.waitForTimeout(3000); }
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000); cur = page.url();
    if (/login|onboarding/.test(cur)) throw new Error("not in dashboard: " + cur);
  });
  await step("Sign out", async () => {
    await page.locator("nav button.rounded-full").first().click({ timeout: 8000 });
    await page.waitForTimeout(700);
    await page.getByText("Log Out").click({ timeout: 8000 });
    await page.waitForTimeout(2500);
  });
  await step("Forgot password → reset → signed in with new password", async () => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 15000 }); cur = page.url();
    await page.click('button:has-text("Forgot password?")');
    await page.fill('input[type="email"]', EMAIL);
    await page.click('button:has-text("Send reset code")');
    await page.waitForSelector('input[placeholder="Reset code"]', { timeout: 15000 });
    const code = await getCode("password reset", EMAIL);
    await page.fill('input[placeholder="Reset code"]', code);
    await page.fill('input[placeholder="New password"]', NEWPW);
    await page.click('button:has-text("Set new password")');
    await page.waitForTimeout(3500);
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000); cur = page.url();
    if (/login/.test(cur)) throw new Error("reset login failed");
  });
  await step("Admin password sign-in still works (regression)", async () => {
    await page.locator("nav button.rounded-full").first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.getByText("Log Out").click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 15000 });
    await page.fill('input[type="email"]', "admin@myos.test");
    await page.fill('input[type="password"]', "MyosAdmin#2026");
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3500);
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000); cur = page.url();
    if (/login|onboarding/.test(cur)) throw new Error("admin bounced: " + cur);
  });

  await b.close();
  const pass = results.filter((r) => r[0]).length;
  console.log(`\n========= AUTH E2E: ${pass}/${results.length} =========`);
  results.forEach((r) => console.log(`${r[0] ? "✓" : "✗"} ${r[1]}${r[2] ? " — " + r[2] : ""}`));
  console.log(`console errors: ${errs.length}`); errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
