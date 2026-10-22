export default {
  providers: [
    {
      // OIDC_SITE_URL overrides the built-in CONVEX_SITE_URL on self-hosted,
      // where the site origin is rewired through the oidc-fix sidecar (:3220)
      // because the backend image serves invalid OIDC metadata/JWKS on :3211.
      // On Convex Cloud, leave OIDC_SITE_URL unset (built-in is correct).
      domain:
        process.env.OIDC_SITE_URL ??
        process.env.CONVEX_SITE_URL ??
        "http://127.0.0.1:3220",
      applicationID: "convex",
    },
  ],
};
