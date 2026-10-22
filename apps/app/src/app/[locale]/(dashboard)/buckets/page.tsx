"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { useWorkspace } from "@/lib/useWorkspace";
import { api } from "@v1/backend/convex/_generated/api";
import type { Id } from "@v1/backend/convex/_generated/dataModel";
import { Button } from "@v1/ui/button";
import { useAction, useMutation, useQuery } from "convex/react";
import { Database, HardDrive, Plus, ArrowRight, RefreshCw, ShieldCheck, Copy, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function BucketsPage() {
  const { current, workspaces } = useWorkspace();
  const myRole = workspaces.find((w) => w._id === current)?.role;
  const canManage = myRole === "owner" || myRole === "admin";
  const [bucketName, setBucketName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const scoped = current ? { workspaceId: current } : "skip";
  const accounts = useQuery(api.storageAccounts.listAccounts, scoped);
  const buckets = useQuery(api.buckets.listBuckets, scoped);
  const ensureDefaultAccount = useMutation(api.storageAccounts.ensureDefaultAccount);
  const createBucket = useAction(api.buckets.createBucket);
  const deleteBucket = useAction(api.buckets.deleteBucket);
  const reconcileBucket = useAction(api.buckets.reconcileBucketNow);
  const disableAccount = useMutation(api.storageAccounts.disableAccount);
  const enableAccount = useMutation(api.storageAccounts.enableAccount);
  const deleteAccount = useMutation(api.storageAccounts.deleteAccount);
  const updateAccount = useMutation(api.storageAccounts.updateAccount);
  const [reconciling, setReconciling] = useState<Id<"buckets"> | null>(null);

  const handleReconcile = async (bucketId: Id<"buckets">, name: string) => {
    setReconciling(bucketId);
    try {
      const res = await reconcileBucket({ id: bucketId });
      toast.success(`Reconciled "${name}" — ${res.objects} object(s) in RustFS`);
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to reconcile bucket");
    } finally {
      setReconciling(null);
    }
  };

  const handleRenameAccount = async () => {
    if (!defaultAccount) return;
    try {
      const name = window.prompt("Account name", defaultAccount.name);
      if (name === null) return; // Cancelled
      const clean = name.trim();
      if (!clean) {
        toast.error("Please enter an account name");
        return;
      }
      await updateAccount({ id: defaultAccount._id, name: clean });
      toast.success("Storage account renamed");
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to rename account");
    }
  };

  const handleToggleAccount = async () => {
    if (!defaultAccount) return;
    try {
      if (defaultAccount.status === "disabled") {
        await enableAccount({ id: defaultAccount._id });
        toast.success("Storage account enabled");
      } else {
        await disableAccount({ id: defaultAccount._id });
        toast.success("Storage account disabled — new S3 operations blocked");
      }
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to update account");
    }
  };

  const handleDeleteAccount = async () => {
    if (!defaultAccount) return;
    try {
      await deleteAccount({ id: defaultAccount._id });
      toast.success("Storage account deleted");
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to delete account");
    }
  };

  useEffect(() => {
    if (current && accounts && accounts.length === 0) {
      void ensureDefaultAccount({ workspaceId: current }).catch(() => {});
    }
  }, [current, accounts, ensureDefaultAccount]);

  const defaultAccount = accounts?.[0];

  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || !defaultAccount) {
      toast.error("No active storage account found");
      return;
    }
    const cleanName = bucketName.trim().toLowerCase();
    if (!cleanName) {
      toast.error("Please provide a bucket name");
      return;
    }
    setCreating(true);
    try {
      await createBucket({
        workspaceId: current,
        accountId: defaultAccount._id,
        name: cleanName,
      });
      setBucketName("");
      toast.success(`Bucket "${cleanName}" created successfully!`);
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to create bucket");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (bucketId: Id<"buckets">, name: string) => {
    try {
      await deleteBucket({ id: bucketId });
      toast.success(`Bucket "${name}" deleted`);
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to delete bucket");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
    toast.success("Copied to clipboard");
  };

  if (!current) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-sm text-primary/60">
        Setting up workspace...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-secondary px-6 py-8 dark:bg-black">
      <div className="mx-auto w-full max-w-screen-xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-medium text-primary">S3 Storage Buckets</h1>
            <p className="text-sm text-primary/60">
              Manage your isolated cloud buckets powered by RustFS object storage.
            </p>
          </div>
          {defaultAccount && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span className="text-primary/70">Storage Account:</span>
              <span className="font-mono font-medium text-primary">{defaultAccount.name}</span>
              <span className="rounded bg-primary/10 px-1 font-mono text-[10px] text-primary/60">
                {defaultAccount.accountCode}
              </span>
            </div>
          )}
        </div>

        {/* Quota & Usage Bar */}
        {defaultAccount && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between text-xs text-primary/70 mb-2">
              <span className="flex items-center gap-1.5">
                <HardDrive className="h-4 w-4" />
                Storage Usage & Quota
              </span>
              <span>
                {fmtBytes(defaultAccount.usage?.bytes ?? 0)} / {fmtBytes(defaultAccount.storageQuotaBytes)} (
                {Math.round(((defaultAccount.usage?.bytes ?? 0) / defaultAccount.storageQuotaBytes) * 100)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      2,
                      Math.round(((defaultAccount.usage?.bytes ?? 0) / defaultAccount.storageQuotaBytes) * 100)
                    )
                  )}%`,
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-primary/50">
              <span>{defaultAccount.usage?.buckets ?? 0} / {defaultAccount.maxBuckets} buckets used</span>
              <span>{defaultAccount.usage?.objects ?? 0} total stored objects</span>
            </div>
          </div>
        )}

        {/* Storage Account Admin (owner/admin only) */}
        {canManage && defaultAccount && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-primary/60" />
                <span className="font-medium text-primary">Storage account admin</span>
                {defaultAccount.status === "disabled" ? (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                    Disabled
                  </span>
                ) : (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                    Active
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={handleRenameAccount}>
                  Rename
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={handleToggleAccount}>
                  {defaultAccount.status === "disabled" ? "Enable" : "Disable"}
                </Button>
                <ConfirmButton
                  onConfirm={handleDeleteAccount}
                  title="Delete Storage Account?"
                  description="Only empty accounts can be deleted. Delete all buckets first."
                  confirmLabel="Delete"
                  label="Delete"
                  className="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20"
                />
              </div>
            </div>
          </div>
        )}

        {/* Create Bucket Form */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-primary mb-3">Create New Bucket</h2>
          <form onSubmit={handleCreateBucket} className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <input
                type="text"
                placeholder="my-bucket-name (3-63 chars, lowercase, numbers, hyphens)"
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value.toLowerCase())}
                pattern="^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$"
                title="3-63 chars, lowercase letters, numbers, and hyphens. Start/end with alphanumeric."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-primary placeholder:text-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>
            <Button type="submit" disabled={creating} className="shrink-0 gap-1.5">
              <Plus className="h-4 w-4" />
              {creating ? "Creating..." : "Create Bucket"}
            </Button>
          </form>
        </div>

        {/* Buckets List */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-primary flex items-center gap-2">
              <Database className="h-4 w-4 text-primary/60" />
              Your Buckets ({buckets?.length ?? 0})
            </h2>
          </div>
          <div className="divide-y divide-border/50">
            {buckets === undefined ? (
              <div className="p-8 text-center text-sm text-primary/40">Loading buckets...</div>
            ) : buckets.length === 0 ? (
              <div className="p-8 text-center">
                <Database className="mx-auto h-8 w-8 text-primary/30 mb-2" />
                <p className="text-sm text-primary/60">No storage buckets found.</p>
                <p className="text-xs text-primary/40 mt-1">Create your first S3 bucket above to get started.</p>
              </div>
            ) : (
              buckets.map((b) => (
                <div
                  key={b._id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-primary/[0.02]"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/buckets/${b._id}`}
                        className="font-mono text-sm font-medium text-primary hover:underline flex items-center gap-1.5"
                      >
                        <Database className="h-3.5 w-3.5 text-primary/70" />
                        {b.name}
                      </Link>
                      <button
                        onClick={() => copyToClipboard(b.name, `name-${b._id}`)}
                        className="text-primary/40 hover:text-primary"
                        title="Copy bucket name"
                      >
                        {copied === `name-${b._id}` ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-primary/50 font-mono">
                      <span>RustFS Target: {b.rustfsName}</span>
                      <span>•</span>
                      <span>Objects: {b.usage?.objects ?? 0}</span>
                      <span>•</span>
                      <span>Size: {fmtBytes(b.usage?.bytes ?? 0)}</span>
                      <span>•</span>
                      <span>Created: {new Date(b.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href={`/buckets/${b._id}`}>
                      <Button variant="outline" size="sm" className="gap-1 text-xs">
                        Browse Objects
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      title="Sync records with RustFS reality"
                      disabled={reconciling === b._id}
                      onClick={() => handleReconcile(b._id, b.name)}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${reconciling === b._id ? "animate-spin" : ""}`} />
                      {reconciling === b._id ? "Syncing..." : "Reconcile"}
                    </Button>
                    <ConfirmButton
                      onConfirm={() => handleDelete(b._id, b.name)}
                      title="Delete Bucket?"
                      description={`Are you sure you want to delete "${b.name}"? The bucket must be completely empty.`}
                      confirmLabel="Delete"
                      label="Delete"
                      className="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
