// Read-only incident probe: no credentials, email submission, or storage writes.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const targets = process.argv.slice(2);
if (!targets.length) throw new Error("Provide explicitly authorized app URLs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  try {
    for (const base of targets) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const evidence = {
        target: new URL(base).origin,
        responses: [],
        scriptResponses: [],
        failedRequests: [],
        pageErrorTypes: [],
        websockets: [],
        requestOrigins: [],
        tests: [],
      };
      const origins = new Set();
      page.on("request", (request) => {
        origins.add(new URL(request.url()).origin);
      });
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (response.request().resourceType() === "script") {
          evidence.scriptResponses.push({ path: url.pathname, status: response.status() });
        }
        if (response.status() >= 400 || response.request().resourceType() === "document") {
          evidence.responses.push({ origin: url.origin, path: url.pathname, status: response.status() });
        }
      });
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        evidence.failedRequests.push({
          origin: url.origin,
          path: url.pathname,
          reason: request.failure()?.errorText,
        });
      });
      // Never collect raw console/error messages or request/response bodies: they can contain secrets.
      page.on("pageerror", (error) => evidence.pageErrorTypes.push(error.name));
      page.on("websocket", (socket) => {
        const url = new URL(socket.url());
        const event = { origin: url.origin, path: url.pathname, opened: true, closed: false, errored: false };
        evidence.websockets.push(event);
        socket.on("close", () => { event.closed = true; });
        socket.on("socketerror", () => { event.errored = true; });
      });
      const test = async (name, fn) => {
        try {
          await fn();
          evidence.tests.push({ name, status: "PASS" });
          return true;
        } catch {
          failures++;
          evidence.tests.push({ name, status: "FAIL", reason: "Assertion or navigation did not complete within the bounded probe" });
          return false;
        }
      };
      try {
        await test("unauthenticated dashboard redirects to login", async () => {
          await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForURL(/\/login(?:\?|$)/, { timeout: 10000 });
        });
        const hydrated = await test("login hydrates and admin tab switches view", async () => {
          await page.getByRole("tab", { name: "Admin Login" }).click({ timeout: 8000 });
          await page.getByRole("heading", { name: "Admin Portal", exact: true }).waitFor({ timeout: 5000 });
          assert.equal(await page.locator('input[type="password"]').count(), 1);
        });
        if (hydrated) {
          await test("user tab restores OTP form", async () => {
            await page.getByRole("tab", { name: "User Login" }).click({ timeout: 5000 });
            await page.getByRole("heading", { name: "User Portal OTP", exact: true }).waitFor({ timeout: 5000 });
            await page.getByRole("button", { name: "Send code", exact: true }).waitFor({ timeout: 5000 });
          });
        } else {
          evidence.tests.push({ name: "user tab restores OTP form", status: "BLOCKED", reason: "Admin tab transition failed; initial server-rendered OTP form cannot prove a transition" });
        }
        await test("unauthenticated storage page redirects to login", async () => {
          await page.goto(`${base}/buckets`, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForURL(/\/login(?:\?|$)/, { timeout: 10000 });
        });
        await test("all encountered script requests succeed", async () => {
          assert.ok(evidence.scriptResponses.length > 0, "Expected actual script responses");
          assert.ok(evidence.scriptResponses.every((r) => r.status >= 200 && r.status < 400));
          assert.equal(evidence.responses.filter((r) => r.status >= 400 && /\/_next\//.test(r.path)).length, 0);
          assert.equal(evidence.failedRequests.filter((r) => /\/_next\//.test(r.path)).length, 0);
          assert.equal(evidence.pageErrorTypes.length, 0);
        });
      } finally {
        evidence.requestOrigins = [...origins];
        console.log(JSON.stringify(evidence));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  process.exitCode = failures ? 1 : 0;
})().catch((error) => {
  console.error(JSON.stringify({ probeFailure: error.name }));
  process.exitCode = 1;
});
