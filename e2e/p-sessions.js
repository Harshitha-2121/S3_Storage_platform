const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://blue-transmission-clinic-photo.trycloudflare.com";
const errs = [], results = [];
const step = async (n, f) => { try { const d = await f(); results.push(true); console.log("PASS  " + n + (d ? " — " + d : "")); } catch (e) { results.push(false); console.log("FAIL  " + n + " — " + e.message.split("\n")[0]); } };
(async () => {
  const b = await chromium.launch({ headless: !!process.env.CI, slowMo: process.env.CI ? 0 : 100 });
  const ctx1 = await b.newContext({ viewport: { width: 1366, height: 850 } });
  const page = await ctx1.newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

  const login = async (p) => {
    await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await p.waitForURL(/login/, { timeout: 20000 });
    await p.locator('input[type="email"]').first().fill("admin@myos.test");
    await p.locator('input[type="password"]').first().fill("MyosAdmin#2026");
    await p.click('button:has-text("Sign in")');
    await p.waitForTimeout(3500);
  };

  await step("login (device 1) → settings shows Active sessions", async () => {
    await login(page);
    await page.goto(BASE + "/en/settings", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Active sessions", { timeout: 20000 });
    await page.waitForSelector("text=this device", { timeout: 10000 });
  });

  await step("second device creates a second session", async () => {
    const ctx2 = await b.newContext({ viewport: { width: 1100, height: 700 } });
    const page2 = await ctx2.newPage();
    await login(page2);
    await page2.close();
    await page.waitForTimeout(2000);
    const rows = await page.locator("text=Started").count();
    if (rows < 2) throw new Error(`expected >=2 sessions, saw ${rows}`);
    return `${rows} sessions listed (live)`;
  });

  await step("Sign out other sessions → only current remains", async () => {
    await page.click('button:has-text("Sign out other sessions")');
    await page.waitForSelector("text=Signed out", { timeout: 8000 });
    await page.waitForTimeout(2000);
    const rows = await page.locator("text=Started").count();
    if (rows !== 1) throw new Error(`expected 1 session left, saw ${rows}`);
  });

  await b.close();
  console.log(`\n===== SESSIONS: ${results.filter(Boolean).length}/${results.length} | console errors: ${errs.length} =====`);
  errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
