const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://blue-transmission-clinic-photo.trycloudflare.com";
const errs = [], results = []; let cur = BASE;
const step = async (n, f) => { try { const d = await f(); results.push([true, n, d || ""]); console.log("PASS  " + n + (d ? " — " + d : "")); } catch (e) { results.push([false, n, e.message.split("\n")[0]]); console.log("FAIL  " + n + " — " + e.message.split("\n")[0]); } };
(async () => {
  const b = await chromium.launch({ headless: !!process.env.CI, slowMo: process.env.CI ? 0 : 120 });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(`[${cur}] ${m.text()}`); });

  await step("login", async () => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 20000 });
    await page.locator('input[type="email"]').first().fill("admin@myos.test");
    await page.locator('input[type="password"]').first().fill("MyosAdmin#2026");
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3500);
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500); cur = page.url();
    if (/login|onboarding/.test(cur)) throw new Error("not logged in: " + cur);
  });
  await step("sidebar shows all nav links (left)", async () => {
    const aside = page.locator("aside");
    for (const label of ["Dashboard", "Jobs", "Platform", "Files", "Settings", "Billing"]) {
      if (!(await aside.getByRole("link", { name: label }).first().isVisible())) throw new Error("missing nav: " + label);
    }
    await page.screenshot({ path: "C:\\Users\\test\\pw-e2e\\shots-sidebar.png" });
  });
  await step("workspace switcher present in sidebar", async () => {
    if (!(await page.locator("aside select").first().isVisible())) throw new Error("no workspace switcher");
  });
  await step("navigate via sidebar → Jobs", async () => {
    await page.locator("aside").getByRole("link", { name: "Jobs" }).click();
    await page.waitForURL(/\/jobs/, { timeout: 10000 }); cur = page.url();
    await page.waitForSelector('button:has-text("Run demo job")', { timeout: 15000 });
  });
  await step("navigate via sidebar → Platform", async () => {
    await page.locator("aside").getByRole("link", { name: "Platform" }).click();
    await page.waitForURL(/\/platform/, { timeout: 10000 }); cur = page.url();
    await page.waitForSelector("text=API keys", { timeout: 15000 });
  });
  await b.close();
  const pass = results.filter((r) => r[0]).length;
  console.log(`\n===== SIDEBAR: ${pass}/${results.length} | console errors: ${errs.length} =====`);
  errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
