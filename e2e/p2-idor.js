// P2: adversarial IDOR / RBAC / tenant-isolation against the LIVE Convex backend.
const { ConvexHttpClient } = require("convex/browser");
const { anyApi } = require("convex/server");
const api = anyApi;
const URL = process.env.CONVEX_URL || "http://10.1.30.14:3210";
const ts = Date.now();
const results = [];
const rec = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const client = (token) => { const c = new ConvexHttpClient(URL); if (token) c.setAuth(token); return c; };
async function signup(email, pw) {
  const c = new ConvexHttpClient(URL);
  // Mandatory email verification: capture the dev-mode code the backend streams
  // back as a log line, then complete the email-verification flow for tokens.
  let captured = "";
  const grab = (...a) => { captured += a.map(String).join(" ") + "\n"; };
  const o = { w: console.warn, l: console.log, e: console.error };
  console.warn = grab; console.log = grab; console.error = grab;
  let r;
  try {
    r = await c.action(api.auth.signIn, { provider: "password", params: { email, password: pw, flow: "signUp" } });
  } finally { console.warn = o.w; console.log = o.l; console.error = o.e; }
  if (r.tokens) return r.tokens.token;
  const m = captured.match(/email verification code for [^:]+: '?(\d+)/);
  if (!m) throw new Error("no verification code captured for " + email);
  const r2 = await c.action(api.auth.signIn, { provider: "password", params: { email, code: m[1], flow: "email-verification" } });
  return r2.tokens.token;
}
// must be DENIED (throw)
async function denied(name, fn) {
  try { const r = await fn(); rec(name, false, "ALLOWED (should deny) -> " + JSON.stringify(r).slice(0, 70)); }
  catch (e) { rec(name, true, "blocked: " + String(e.message || e).slice(0, 45)); }
}
async function allowed(name, fn) {
  try { const r = await fn(); rec(name, true); return r; }
  catch (e) { rec(name, false, "BLOCKED (should allow): " + String(e.message || e).slice(0, 70)); return null; }
}

(async () => {
  const emailA = `atka${ts}@myos.test`, emailB = `atkb${ts}@myos.test`;
  const tokA = await signup(emailA, "PasswordA#2026");
  const tokB = await signup(emailB, "PasswordB#2026");
  const A = client(tokA), B = client(tokB);
  const wsA = await A.mutation(api.orgs.createWorkspace, { name: "A-ws" });
  const wsB = await B.mutation(api.orgs.createWorkspace, { name: "B-ws" });
  console.log(`wsA=${wsA} wsB=${wsB}\n--- positive controls ---`);

  await allowed("A reads own jobs", () => A.query(api.jobs.list, { workspaceId: wsA }));
  await allowed("A creates job (own ws)", () => A.mutation(api.jobs.create, { workspaceId: wsA, kind: "demo", input: {} }));
  await allowed("A creates apiKey (own ws)", () => A.action(api.apiKeys.create, { workspaceId: wsA, name: "k" }));
  const aKeys = await A.query(api.apiKeys.listMine, { workspaceId: wsA });
  const keyAId = aKeys && aKeys[0] && aKeys[0]._id;

  console.log("--- IDOR reads: B -> A's workspace (must deny) ---");
  await denied("B reads A.jobs.list", () => B.query(api.jobs.list, { workspaceId: wsA }));
  await denied("B reads A.usage.mine", () => B.query(api.usage.mine, { workspaceId: wsA }));
  await denied("B reads A.apiKeys.listMine", () => B.query(api.apiKeys.listMine, { workspaceId: wsA }));
  await denied("B reads A.files.list", () => B.query(api.files.list, { workspaceId: wsA }));
  await denied("B reads A.audit.recent", () => B.query(api.audit.recent, { workspaceId: wsA }));
  await denied("B reads A.backend.listEvents", () => B.query(api.backend.listEvents, { workspaceId: wsA }));
  await denied("B reads A.orgs.members", () => B.query(api.orgs.members, { workspaceId: wsA }));
  await denied("B reads A.orgs.pendingInvites", () => B.query(api.orgs.pendingInvites, { workspaceId: wsA }));

  console.log("--- IDOR writes: B -> A's workspace (must deny) ---");
  await denied("B creates job in A.ws", () => B.mutation(api.jobs.create, { workspaceId: wsA, kind: "x", input: {} }));
  await denied("B creates apiKey in A.ws", () => B.action(api.apiKeys.create, { workspaceId: wsA, name: "x" }));
  await denied("B generateUploadUrl in A.ws", () => B.mutation(api.files.generateUploadUrl, { workspaceId: wsA }));
  await denied("B invites to A.ws", () => B.mutation(api.orgs.invite, { workspaceId: wsA, email: "x@x.com", role: "admin" }));
  if (keyAId) await denied("B revokes A's apiKey", () => B.mutation(api.apiKeys.revoke, { id: keyAId }));

  console.log("--- RBAC: member cannot do admin ops ---");
  await A.mutation(api.orgs.invite, { workspaceId: wsA, email: emailB, role: "member" });
  const invs = await B.query(api.orgs.myInvites, {});
  rec("B sees own invite (same-case email)", !!(invs && invs.length), invs ? `${invs.length} invite(s)` : "none");
  if (invs && invs.length) {
    await allowed("B accepts invite (becomes member)", () => B.mutation(api.orgs.acceptInvite, { inviteId: invs[0]._id }));
    await allowed("B(member) reads A.jobs.list", () => B.query(api.jobs.list, { workspaceId: wsA }));
    await denied("B(member) cannot invite (admin-only)", () => B.mutation(api.orgs.invite, { workspaceId: wsA, email: "y@y.com", role: "admin" }));
    await denied("B(member) cannot see pendingInvites", () => B.query(api.orgs.pendingInvites, { workspaceId: wsA }));
  }

  console.log("--- email case-sensitivity probe ---");
  await A.mutation(api.orgs.invite, { workspaceId: wsA, email: emailB.toUpperCase(), role: "member" });
  const invs2 = await B.query(api.orgs.myInvites, {});
  const seesUpper = invs2 && invs2.some((i) => true) && invs2.length > (invs ? invs.length - 1 : 0);
  rec("invite with UPPERCASE email visible to B", !!(invs2 && invs2.length >= 1) && seesUpper === true ? true : false,
    `myInvites now=${invs2 ? invs2.length : 0} (if 0, case-sensitivity bug)`);

  console.log("--- unauth control ---");
  try {
    const r = await client(null).query(api.jobs.list, { workspaceId: wsA });
    rec("unauth jobs.list returns no data", Array.isArray(r) && r.length === 0, `returned ${JSON.stringify(r).slice(0,40)}`);
  } catch (e) { rec("unauth jobs.list returns no data", true, "threw (also safe)"); }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n================ P2 RESULT: ${pass}/${results.length} ================`);
  const fails = results.filter((r) => !r.pass);
  if (fails.length) { console.log("FAILURES (potential bugs):"); fails.forEach((f) => console.log("  ✗ " + f.name + " — " + f.detail)); }
  else console.log("No isolation/RBAC violations found.");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
