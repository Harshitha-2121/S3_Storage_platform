const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://yellow-showers-initiative-advisors.trycloudflare.com";
(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  await page.goto(BASE + "/en/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  // Statically dump all views by clicking tabs
  const dumpView = async (label) => {
    if (label) {
      try { await page.getByRole("button", { name: label }).click({ timeout: 5000 }); await page.waitForTimeout(800); } catch (e) { console.log("(tab click failed:", label, ")", e.message.split("\n")[0]); }
    }
    console.log(`\n===== VIEW: ${label || "initial"} =====`);
    const els = await page.locator("input, button").all();
    for (const el of els) {
      const txt = (await el.getAttribute("type")) + "|" + (await el.placeholder?.catch?.(() => null) ?? (await el.inputValue ? "" : "")) + "|" + (await el.textContent()).trim().slice(0, 40);
      try {
        const t = await el.getAttribute("type");
        const ph = await el.getAttribute("placeholder");
        const tc = ((await el.textContent()) || "").trim().slice(0, 50);
        console.log("  ", t, "|", ph ?? "", "|", tc);
      } catch { }
    }
  };
  await dumpView(null);
  await dumpView("Admin Login");
  await dumpView("User Login");
  await dumpView("Create an account");
  await dumpView("Forgot password");
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
