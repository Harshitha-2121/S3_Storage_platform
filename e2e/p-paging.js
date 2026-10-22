const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://blue-transmission-clinic-photo.trycloudflare.com";
const errs = [], results = [];
const step = async (n, f) => { try { const d = await f(); results.push(true); console.log("PASS  " + n + (d ? " — " + d : "")); } catch (e) { results.push(false); console.log("FAIL  " + n + " — " + e.message.split("\n")[0]); } };
(async () => {
  const b = await chromium.launch({ headless: !!process.env.CI, slowMo: process.env.CI ? 0 : 50 });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

  await step("login → Jobs", async () => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/login/, { timeout: 20000 });
    await page.locator('input[type="email"]').first().fill("admin@myos.test");
    await page.locator('input[type="password"]').first().fill("MyosAdmin#2026");
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3500);
    await page.goto(BASE + "/en/jobs", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button:has-text("Run demo job")', { timeout: 20000 });
    await page.waitForTimeout(2000);
  });

  await step("ensure >20 jobs exist (seed via UI)", async () => {
    let rows = await page.locator("tbody tr").count();
    let toCreate = Math.max(0, 22 - rows);
    for (let i = 0; i < toCreate; i++) {
      await page.click('button:has-text("Run demo job")');
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(2000);
    return `seeded ${toCreate}`;
  });

  await step("first page capped at 20 + Load more visible", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("tbody tr", { timeout: 20000 });
    await page.waitForTimeout(2500);
    const rows = await page.locator("tbody tr").count();
    if (rows !== 20) throw new Error(`expected 20 rows on first page, got ${rows}`);
    if (!(await page.locator('button:has-text("Load more")').isVisible())) throw new Error("no Load more button");
    return `rows=${rows}`;
  });

  await step("Load more appends next page", async () => {
    const before = await page.locator("tbody tr").count();
    await page.click('button:has-text("Load more")');
    await page.waitForTimeout(2500);
    const after = await page.locator("tbody tr").count();
    if (after <= before) throw new Error(`rows did not grow (${before} → ${after})`);
    return `${before} → ${after}`;
  });

  await b.close();
  console.log(`\n===== PAGING: ${results.filter(Boolean).length}/${results.length} | console errors: ${errs.length} =====`);
  errs.forEach((e) => console.log("  - " + e));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
