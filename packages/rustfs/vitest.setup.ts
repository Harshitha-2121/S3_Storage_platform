import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load the package-local .env (git-ignored) into process.env so the
// integration tests can reach the live RustFS instance. Existing
// environment variables take precedence; values are never printed.
const envPath = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator);
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(separator + 1);
    }
  }
}
