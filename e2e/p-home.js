const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://blue-transmission-clinic-photo.trycloudflare.com";
const errs = [], results = []; let cur = BASE;
const step = async (n, f) => { try { const d = await f(); results.push([true, n, d || ""]); console.log("PASS  " + n + (d ? " — " + d : "")); } catch (e) { results.push([false, n, e.message.split("\n")[0]]); console.log("FAIL  " + n + " — " + e.message.split("\n")[0]); } };
(async () => {
  const b = await chromium.launch({ headless: !!process.env.CI, slowMo: process.env.CI ? 0 : 100 });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await step("login → dashboard home", async () => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 20000 });
    await page.locator('input[type="email"]').first().fill("admin@myos.test");
    await page.locator('input[type="password"]').first().fill("MyosAdmin#2026");
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3500);
    await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" }); cur = page.url();
    if (/login|onboarding/.test(cur)) throw new Error("not home: " + cur);
  });
  await step("stat cards render", async () => {
    for (const label of ["Open jobs", "Members", "Files", "Usage events"]) {
      await page.waitForSelector(`text=${label}`, { timeout: 15000 });
    }
    await page.waitForSelector("text=Recent activity", { timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "C:\\Users\\test\\pw-e2e\\shots-home.png" });
  });
  await b.close();
  const pass = results.filter((r) => r[0]).length;
  console.log(`\n===== HOME: ${pass}/${results.length} | console errors: ${errs.length} =====`);
  errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
