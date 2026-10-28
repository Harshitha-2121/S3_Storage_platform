const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://yellow-showers-initiative-advisors.trycloudflare.com";
const CONVEX_DIRECT = process.env.CONVEX_DIRECT || "http://10.70.70.47:3210";
const EMAIL = `qa-d3-${Date.now()}@myos.test`;

async function fetchCode(email) {
  const r = await fetch(`${CONVEX_DIRECT}/api/action`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "auth:signIn", args: { provider: "resend-otp", params: { email } }, format: "json" }),
  });
  return (await r.json())?.logLines?.join(" || ") || "";
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  const bad = [];
  page.on("response", async (r) => {
    if (r.status() >= 400) {
      let body = "";
      try { body = (await r.text()).slice(0, 200); } catch { }
      bad.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 170)}\n    body: ${body}`);
    }
    if (r.url().includes("convex") || r.url().includes("3210")) {
      bad.push(`CONVEX-HIT ${r.status()} ${r.request().method()} ${r.url().slice(0, 170)}`);
    }
  });
  await page.goto(BASE + "/en/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.fill('input[type="email"]', EMAIL);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.waitForTimeout(3000);
  const logs = await fetchCode(EMAIL);
  console.log("LOGCHANNEL:", logs.slice(0, 250));
  const inputs = await page.locator("input").evaluateAll((els) => els.map((e) => `${e.type}|${e.placeholder || ""}|vis=${e.offsetParent !== null}`));
  console.log("INPUTS:", JSON.stringify(inputs));
  const txt = await page.locator("body").innerText();
  console.log("BODY:\n", txt.replace(/\n{2,}/g, " ~ ").slice(0, 700));
  console.log("\nBAD RESPONSES:");
  bad.forEach((x) => console.log(" ", x));
  await b.close();
})().catch((e) => { console.error("FATAL", e.message || e); process.exit(1); });
