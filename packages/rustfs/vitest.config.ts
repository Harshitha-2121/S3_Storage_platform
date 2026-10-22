import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment: the client uses global fetch / Web Crypto and
    // the setup file reads the package-local .env with node:fs.
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
