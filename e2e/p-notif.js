const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://blue-transmission-clinic-photo.trycloudflare.com";
const errs = [], results = [];
const step = async (n, f) => { try { await f(); results.push(true); console.log("PASS  " + n); } catch (e) { results.push(false); console.log("FAIL  " + n + " — " + e.message.split("\n")[0]); } };
(async () => {
  const b = await chromium.launch({ headless: !!process.env.CI, slowMo: process.env.CI ? 0 : 120 });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await step("login", async () => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 20000 });
    await page.locator('input[type="email"]').first().fill("admin@myos.test");
    await page.locator('input[type="password"]').first().fill("MyosAdmin#2026");
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3500);
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  });
  await step("notifications bell visible in topbar", async () => {
    await page.waitForSelector('button[aria-label="Notifications"]', { timeout: 12000 });
  });
  await step("bell opens notifications panel", async () => {
    await page.click('button[aria-label="Notifications"]');
    await page.waitForSelector("text=Notifications", { timeout: 6000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "C:\\Users\\test\\pw-e2e\\shots-notif.png" });
  });
  await b.close();
  console.log(`\n===== NOTIF: ${results.filter(Boolean).length}/${results.length} | console errors: ${errs.length} =====`);
  errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
