import { ConvexError } from "convex/values";

/**
 * Gate for seed/test-only internal functions. They are never callable from clients
 * (internal*), but this also blocks accidental admin/CLI use in real deployments.
 * Enable with: convex env set DEV_SEED 1
 */
export function requireDevSeed() {
  if (process.env.DEV_SEED !== "1") {
    throw new ConvexError("Dev/seed functions are disabled (set DEV_SEED=1)");
  }
}
