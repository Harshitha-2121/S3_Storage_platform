/**
 * Central project config — the single place to change when cloning this template
 * for a new project. Most runtime wiring reads env vars (set by deploy/setup.sh),
 * but this documents the contract and gives non-secret defaults.
 */
export const projectConfig = {
  /** Used for branding + the @scope of workspace packages (rename via setup notes). */
  name: "myos",

  /** Where the stack runs — a LAN IP or a domain. setup.sh injects this as $HOST. */
  host: "10.1.30.14",

  ports: {
    convex: 3210, // backend API
    convexSite: 3211, // HTTP actions + JWKS/OIDC (/.well-known/*)
    convexDashboard: 6791,
    app: 3000, // Next.js dashboard
    backend: 4000, // external/reference backend
  },

  /** The external ("real") backend the dashboard attaches to. */
  backend: {
    url: "http://10.1.30.14:4000",
    /** JWT audience your backend must require when verifying the Convex token. */
    audience: "convex",
    /** JWKS endpoint your backend fetches to verify Convex-issued JWTs. */
    jwks: "http://10.1.30.14:3211/.well-known/jwks.json",
  },
} as const;
