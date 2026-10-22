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
  await step("Ctrl+K opens palette", async () => {
    await page.keyboard.press("Control+k");
    await page.waitForSelector('input[placeholder="Jump to…"]', { timeout: 5000 });
  });
  await step("filter + Enter navigates to Jobs", async () => {
    await page.fill('input[placeholder="Jump to…"]', "job");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/jobs/, { timeout: 8000 });
  });
  await b.close();
  console.log(`\n===== CMDK: ${results.filter(Boolean).length}/${results.length} | console errors: ${errs.length} =====`);
  errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
