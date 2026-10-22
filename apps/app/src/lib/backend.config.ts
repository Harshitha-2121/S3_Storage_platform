// Central config for the external ("real") backend the dashboard attaches to.
// Swap a backend per project by changing NEXT_PUBLIC_BACKEND_URL + the Convex env vars.
export const backendConfig = {
  // Public base URL for the DIRECT path (browser -> backend, carrying the Convex JWT).
  url: process.env.NEXT_PUBLIC_BACKEND_URL ?? "",
  // Audience your backend should require when verifying the Convex JWT.
  // (JWKS lives at <CONVEX_SITE_URL>/.well-known/jwks.json)
  audience: "convex",
};

export type BackendRoute = { path: string; mode: "direct" | "proxy" };

// Declare which calls go DIRECT (browser->backend w/ JWT) vs PROXY (via Convex action).
export const routes = {
  whoami: { path: "/whoami", mode: "direct" },
  echo: { path: "/proxy-echo", mode: "proxy" },
} satisfies Record<string, BackendRoute>;
