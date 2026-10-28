"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { useWorkspace } from "@/lib/useWorkspace";
import { api } from "@v1/backend/convex/_generated/api";
import type { Id } from "@v1/backend/convex/_generated/dataModel";
import { Button } from "@v1/ui/button";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-primary">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </div>
  );
}
function Row({
  left,
  right,
}: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
      <span className="truncate font-mono text-primary/80">{left}</span>
      <span className="shrink-0 text-primary/60">{right}</span>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4 text-sm text-primary/40">{children}</div>;
}

function eventLabel(ev: { type: string; payload?: unknown }): string {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  // Job events: tell jobs apart by their id tail (kinds are often all "demo").
  if (typeof p.jobId === "string" && p.jobId.length >= 6)
    return `${ev.type} · …${p.jobId.slice(-6)}`;
  if (typeof p.message === "string" && p.message.length > 0)
    return `${ev.type} · ${p.message.slice(0, 28)}`;
  return ev.type;
}

export default function PlatformPage() {
  const { workspaces, current, select } = useWorkspace();
  const createWorkspace = useMutation(api.orgs.createWorkspace);
  const createKey = useAction(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);
  const sendInvite = useMutation(api.orgs.invite);
  const withdrawInvite = useMutation(api.orgs.withdrawInvite);
  const acceptInvite = useMutation(api.orgs.acceptInvite);
  const removeMember = useMutation(api.orgs.removeMember);
  const changeRole = useMutation(api.orgs.changeRole);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [auditExpanded, setAuditExpanded] = useState(false);
  const AUDIT_PREVIEW = 5;

  const scoped = current ? { workspaceId: current } : "skip";
  const members = useQuery(api.orgs.members, scoped);
  const keys = useQuery(api.apiKeys.listMine, scoped);
  const usage = useQuery(api.usage.mine, scoped);
  const audit = useQuery(api.audit.recent, scoped);
  const events = useQuery(api.backend.listEvents, scoped);
  const pending = useQuery(api.orgs.pendingInvites, scoped);
  const myInvites = useQuery(api.orgs.myInvites);
  const myRole = workspaces.find((w) => w._id === current)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  if (!current) {
    return (
      <div className="p-8 text-sm text-primary/60">
        Setting up your workspace…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-secondary px-6 py-8 dark:bg-black">
      <div className="z-10 mx-auto w-full max-w-screen-xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-medium text-primary">Platform</h1>
            <p className="text-sm text-primary/60">
              Multi-tenant: members, invites, usage, API keys, audit & events —
              scoped to the selected workspace.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={current}
              onChange={(e) => select(e.target.value as Id<"workspaces">)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              {workspaces.map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name} ({w.role})
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={async () => {
                const name = window.prompt("New workspace name");
                if (name) {
                  select(await createWorkspace({ name }));
                  toast.success("Workspace created");
                }
              }}
            >
              + Workspace
            </Button>
          </div>
        </div>

        {myInvites && myInvites.length > 0 && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
            <p className="mb-2 text-sm font-medium text-primary">
              You have pending invites
            </p>
            {myInvites.map((inv) => (
              <div
                key={inv._id}
                className="flex items-center justify-between py-1 text-sm"
              >
                <span className="text-primary/80">
                  {inv.workspaceName ?? "workspace"} · {inv.role}
                </span>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await acceptInvite({ inviteId: inv._id });
                      toast.success("Invite accepted");
                    } catch (err: any) {
                      toast.error(
                        err?.data ?? err?.message ?? "Failed to accept invite",
                      );
                    }
                  }}
                >
                  Accept
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card
              title="Members"
              action={
                <form
                  className="flex items-center gap-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!inviteEmail) return;
                    try {
                      await sendInvite({
                        workspaceId: current,
                        email: inviteEmail,
                        role: inviteRole,
                      });
                      setInviteEmail("");
                      toast.success("Invitation sent");
                    } catch (err: any) {
                      toast.error(
                        err?.data ?? err?.message ?? "Failed to send invite",
                      );
                    }
                  }}
                >
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email to invite"
                    type="email"
                    className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="rounded-md border border-border bg-background px-1 py-1 text-xs"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                  <Button size="sm" variant="outline" type="submit">
                    Invite
                  </Button>
                </form>
              }
            >
              {members?.length ? (
                members.map((m) => (
                  <Row
                    key={m._id}
                    left={m.name ?? m.email ?? "—"}
                    right={
                      canManage && m.role !== "owner" ? (
                        <span className="flex items-center gap-2">
                          <select
                            value={m.role}
                            onChange={async (e) => {
                              try {
                                await changeRole({
                                  workspaceId: current,
                                  memberId: m._id,
                                  role: e.target.value,
                                });
                                toast.success("Role updated");
                              } catch (err: any) {
                                toast.error(
                                  err?.data ??
                                    err?.message ??
                                    "Failed to update role",
                                );
                              }
                            }}
                            className="rounded border border-border bg-background px-1 py-0.5 text-xs"
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </select>
                          <ConfirmButton
                            label="remove"
                            title="Remove member?"
                            description={m.name ?? m.email ?? undefined}
                            confirmLabel="Remove"
                            onConfirm={async () => {
                              try {
                                await removeMember({
                                  workspaceId: current,
                                  memberId: m._id,
                                });
                                toast.success("Member removed");
                              } catch (err: any) {
                                toast.error(
                                  err?.data ??
                                    err?.message ??
                                    "Failed to remove member",
                                );
                              }
                            }}
                          />
                        </span>
                      ) : (
                        m.role
                      )
                    }
                  />
                ))
              ) : (
                <Empty>No members</Empty>
              )}
              {pending?.map((inv) => (
                <Row
                  key={inv._id}
                  left={`⏳ ${inv.email}`}
                  right={
                    <span className="flex items-center gap-2">
                      <span>{`invited · ${inv.role}`}</span>
                      {canManage && (
                        <ConfirmButton
                          label="withdraw"
                          title="Withdraw invitation?"
                          description={inv.email}
                          confirmLabel="Withdraw"
                          onConfirm={async () => {
                            try {
                              await withdrawInvite({ inviteId: inv._id });
                              toast.success("Invitation withdrawn");
                            } catch (err: any) {
                              toast.error(
                                err?.data ??
                                  err?.message ??
                                  "Failed to withdraw invite",
                              );
                            }
                          }}
                        />
                      )}
                    </span>
                  }
                />
              ))}
            </Card>

            <Card
              title="API keys"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const name = window.prompt("Key name");
                      if (name === null) return; // user pressed Cancel: create nothing
                      const clean = name.trim();
                      if (!clean) {
                        toast.error("Please enter a key name");
                        return;
                      }
                      const r = await createKey({
                        workspaceId: current,
                        name: clean,
                      });
                      setNewKey(r.key);
                      toast.success("API key created");
                    } catch (err: any) {
                      toast.error(
                        err?.data ?? err?.message ?? "Failed to create API key",
                      );
                    }
                  }}
                >
                  + Create
                </Button>
              }
            >
              {newKey && (
                <div className="m-3 break-all rounded bg-green-500/10 p-2 font-mono text-xs text-green-700">
                  Copy now (shown once): {newKey}
                </div>
              )}
              {keys?.length ? (
                keys.map((k) => (
                  <Row
                    key={k._id}
                    left={`${k.name} · ${k.prefix}…`}
                    right={
                      k.revoked ? (
                        "revoked"
                      ) : (
                        <ConfirmButton
                          label="revoke"
                          title="Revoke API key?"
                          description={`${k.name} · ${k.prefix}…`}
                          confirmLabel="Revoke"
                          onConfirm={async () => {
                            try {
                              await revokeKey({ id: k._id });
                              toast.success("Key revoked");
                            } catch (err: any) {
                              toast.error(
                                err?.data ??
                                  err?.message ??
                                  "Failed to revoke key",
                              );
                            }
                          }}
                        />
                      )
                    }
                  />
                ))
              ) : (
                <Empty>No keys</Empty>
              )}
            </Card>
          </div>
          <div className="space-y-6">
            <Card title="Usage">
              {usage?.length ? (
                usage.map((u) => (
                  <Row key={u._id} left={u.metric} right={String(u.count)} />
                ))
              ) : (
                <Empty>No usage yet</Empty>
              )}
            </Card>

            <Card title="Audit log">
              {audit?.length ? (
                <>
                  {(auditExpanded ? audit : audit.slice(0, AUDIT_PREVIEW)).map(
                    (a) => (
                      <Row
                        key={a._id}
                        left={a.action}
                        right={new Date(a.at).toLocaleTimeString()}
                      />
                    ),
                  )}
                  {audit.length > AUDIT_PREVIEW && (
                    <button
                      onClick={() => setAuditExpanded((v) => !v)}
                      className="w-full px-4 py-2.5 text-center text-xs font-medium text-primary/60 hover:text-primary"
                    >
                      {auditExpanded
                        ? "Show less"
                        : `See more (${audit.length - AUDIT_PREVIEW} more)`}
                    </button>
                  )}
                </>
              ) : (
                <Empty>No activity</Empty>
              )}
            </Card>

            <Card title="Events (from backend)">
              {events?.length ? (
                events.map((ev) => (
                  <Row
                    key={ev._id}
                    left={eventLabel(ev)}
                    right={new Date(ev.receivedAt).toLocaleTimeString()}
                  />
                ))
              ) : (
                <Empty>No events yet</Empty>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
