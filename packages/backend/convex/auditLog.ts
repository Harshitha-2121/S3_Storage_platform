import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * Plain audit helper — kept dependency-free (no orgs import) so any mutation can call it
 * without creating an import cycle. Records an action into the auditLogs table.
 */
export async function audit(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
  action: string,
  meta?: unknown,
) {
  await ctx.db.insert("auditLogs", {
    workspaceId,
    userId,
    action,
    meta: meta ?? null,
    at: Date.now(),
  });
}
