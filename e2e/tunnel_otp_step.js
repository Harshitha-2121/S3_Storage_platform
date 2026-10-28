const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE_URL || "https://yellow-showers-initiative-advisors.trycloudflare.com";
const CONVEX_DIRECT = process.env.CONVEX_DIRECT || "http://10.70.70.47:3210";
const EMAIL = `qa-d2-${Date.now()}@myos.test`;

async function fetchCode(email) {
  const r = await fetch(`${CONVEX_DIRECT}/api/action`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "auth:signIn", args: { provider: "resend-otp", params: { email } }, format: "json" }),
  });
  const j = await r.json();
  const lines = (j?.logLines || []).join(" || ");
  const m = lines.match(new RegExp(`OTP for [^0-9:]*?[0-9]+@myos\\.test:\\s*([0-9]{6,8})`));
  if (m) return m[1];
  // tolerant: find "OTP for <email>: <digits>" allowing digits inside the email prefix
  const alt = lines.match(/OTP for .*?([0-9]{6})\s*['"]|OTP for .*?:\s*([0-9]{6})/);
  return alt ? (alt[2] || alt[1]) : null;
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto(BASE + "/en/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log("url:", page.url());
  await page.fill('input[type="email"]', EMAIL);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("api/auth"), { timeout: 30000 }).catch(() => null),
    page.getByRole("button", { name: "Send code" }).click(),
  ]);
  console.log("api/auth response:", resp ? `${resp.status()} ${resp.url().slice(0, 120)}` : "none seen");
  await page.waitForTimeout(2500);
  // dump DOM
  const inputs = await page.locator("input").evaluateAll(
    (els) => els.map((e) => `${e.type}|${(e.placeholder || "")}|${e.name || ""}|visible=${e.offsetParent !== null}`)
  );
  console.log("INPUTS:", JSON.stringify(inputs, null, 1));
  const buttons = await page.locator("button").evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 40)));
  console.log("BUTTONS:", JSON.stringify(buttons));
  const bodyText = await page.locator("body").innerText();
  console.log("BODY TEXT (first 1200 chars):\n", bodyText.replace(/\n{2,}/g, "\n").slice(0, 1200));
  // fetch parallel code now
  const code = await fetchCode(EMAIL);
  console.log("PARALLEL CODE:", code);
  if (code) {
    const inputs2 = inputs.filter((i) => i.startsWith("text|") || i.startsWith("tel|") || i.startsWith("number|")).join(", ");
    console.log("candidate code inputs:", inputs2);
  }
  console.log("CONSOLE ERRORS:", JSON.stringify(errors, null, 1));
  await page.screenshot({ path: "after-send.png" });
  await b.close();
})().catch((e) => { console.error("FATAL", e.message || e); process.exit(1); });
