const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://blue-transmission-clinic-photo.trycloudflare.com";
const errs = [], results = []; let cur = BASE;
const step = async (n, f) => { try { const d = await f(); results.push([true, n, d || ""]); console.log("PASS  " + n); } catch (e) { results.push([false, n, e.message.split("\n")[0]]); console.log("FAIL  " + n + " — " + e.message.split("\n")[0]); } };
(async () => {
  const b = await chromium.launch({ headless: !!process.env.CI, slowMo: process.env.CI ? 0 : 150 });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(`[${cur}] ${m.text()}`); });

  await step("login + open Platform", async () => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 20000 });
    await page.locator('input[type="email"]').first().fill("admin@myos.test");
    await page.locator('input[type="password"]').first().fill("MyosAdmin#2026");
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3500);
    await page.goto(BASE + "/en/platform", { waitUntil: "domcontentloaded" }); cur = page.url();
    await page.waitForSelector("text=API keys", { timeout: 20000 });
  });
  await step("create API key → toast appears", async () => {
    page.once("dialog", (d) => d.accept("feedback-key"));
    await page.click('button:has-text("+ Create")');
    await page.waitForSelector("text=API key created", { timeout: 10000 }); // sonner toast
  });
  await step("revoke → confirm dialog → confirm → toast", async () => {
    await page.locator('button:has-text("revoke")').first().click();
    await page.waitForSelector("text=Revoke API key?", { timeout: 8000 }); // confirm dialog
    await page.getByRole("button", { name: "Revoke" }).click();
    await page.waitForSelector("text=Key revoked", { timeout: 10000 }); // toast
  });
  await b.close();
  const pass = results.filter((r) => r[0]).length;
  console.log(`\n===== FEEDBACK: ${pass}/${results.length} | console errors: ${errs.length} =====`);
  errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
