// Live tunnel diagnostic: what does the deployed app actually connect to?
const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://yellow-showers-initiative-advisors.trycloudflare.com";
const errs = [], wsEndpoints = [], failedReqs = [];
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 850 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on("websocket", (w) => { wsEndpoints.push(w.url()); w.on("close", () => wsEndpoints.push(`CLOSED: ${w.url()}`)); });
  page.on("requestfailed", (r) => failedReqs.push(`${r.method()} ${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  console.log("after goto /  url:", page.url());
  await page.goto(BASE + "/en/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log("after goto /en/login url:", page.url());
  // Try OTP email signin through the UI
  await page.fill('input[type="email"]', "tunnel-probe-" + Date.now() + "@myos.test");
  const btns = await page.locator("button").allTextContents();
  console.log("buttons visible:", JSON.stringify(btns).slice(0, 600));
  console.log("\nWS endpoints:", JSON.stringify(wsEndpoints.slice(0, 12), null, 1));
  console.log("\nFailed requests:", JSON.stringify(failedReqs.slice(0, 12), null, 1));
  console.log("\nConsole errors/warnings:", JSON.stringify(errs.slice(0, 12), null, 1));
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
