// Probe: uppercase invite -> acceptInvite (case sensitivity behavior)
const { ConvexHttpClient } = require("convex/browser");
const { anyApi } = require("convex/server");
const api = anyApi;
const URL = process.env.CONVEX_URL || "http://10.70.70.47:3210";
const ts = Date.now();

async function signup(email, pw) {
  const c = new ConvexHttpClient(URL);
  let captured = "";
  const o = { w: console.warn, l: console.log, e: console.error };
  console.warn = (...a) => { captured += a.map(String).join(" ") + "\n"; };
  console.log = console.warn; console.error = console.warn;
  let r;
  try {
    r = await c.action(api.auth.signIn, { provider: "password", params: { email, password: pw, flow: "signUp" } });
  } finally { console.warn = o.w; console.log = o.l; console.error = o.e; }
  if (r.tokens) return r.tokens.token;
  const m = captured.match(/email verification code for [^:]+: '?(\d+)/);
  console.log("[diag] captured:", captured.slice(0, 220).replace(/\n/g, " | "));
  const r2 = await c.action(api.auth.signIn, { provider: "password", params: { email, code: m?.[1], flow: "email-verification" } });
  return r2.tokens.token;
}

(async () => {
  const ownerE = `own-${ts}@myos.test`, memberE = `mem-${ts}@myos.test`;
  const owTok = await signup(ownerE, "OwnerPass#2026");
  const memTok = await signup(memberE, "MemberPass#2026");
  console.log("tokens ok:", !!owTok, !!memTok);
  const Ow = new ConvexHttpClient(URL); Ow.setAuth(owTok);
  const wsA = await Ow.mutation(api.orgs.createWorkspace, { name: "OW-ws-" + ts });
  const upEmail = memberE.toUpperCase();
  await Ow.mutation(api.orgs.invite, { workspaceId: wsA, email: upEmail, role: "member" });
  const Me = new ConvexHttpClient(URL); Me.setAuth(memTok);
  const invs = await Me.query(api.orgs.myInvites, {});
  console.log("myInvites:", JSON.stringify((invs || []).map((i) => ({ id: i._id, email: i.email, ws: i.workspaceId }))));
  
  // Sanity: does member's email match? (myInvites match by exact string)
  const ui = invs && invs.find((i) => i.email === upEmail);
  if (!ui) { console.log("invite not found via myInvites (query match is exact-string)"); }
  else {
    try {
      const out = await Me.mutation(api.orgs.acceptInvite, { inviteId: ui._id });
      console.log("UPPERCASE invite ACCEPTED (case-lenient):", JSON.stringify(out).slice(0, 120));
    } catch (e) {
      console.log("UPPERCASE invite REJECTED (case-strict):", String(e.message || e).slice(0, 140));
    }
  }
  Ow.close(); Me.close();
})().catch((e) => { console.error("FATAL", e.message || e); process.exit(1); });
