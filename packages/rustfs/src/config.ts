import type { Credential } from "./sigv4";

export type RustFSConfig = {
  /** Origin of the RustFS S3 API, e.g. http://localhost:9000 (no path). */
  endpoint: string;
  /** SigV4 signing region. RustFS accepts any value; defaults to us-east-1. */
  region: string;
  /**
   * Root credentials — used exclusively for the administrative API
   * (/rustfs/admin/v3). Never ship these to a browser.
   */
  rootCredential: Credential;
};

/**
 * Build the client configuration from environment variables.
 * Throws when the root credentials are missing.
 */
export function rustfsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RustFSConfig {
  const endpoint = (env.RUSTFS_ENDPOINT ?? "http://localhost:9000").replace(
    /\/+$/,
    "",
  );
  const accessKeyId = env.RUSTFS_ACCESS_KEY;
  const secretAccessKey = env.RUSTFS_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "RUSTFS_ACCESS_KEY and RUSTFS_SECRET_KEY are required (root credentials; server-side only)",
    );
  }
  const url = new URL(endpoint);
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error(
      "RUSTFS_ENDPOINT must be an origin (scheme://host:port) without a path",
    );
  }
  return {
    endpoint,
    region: env.RUSTFS_REGION ?? "us-east-1",
    rootCredential: { accessKeyId, secretAccessKey },
  };
}
