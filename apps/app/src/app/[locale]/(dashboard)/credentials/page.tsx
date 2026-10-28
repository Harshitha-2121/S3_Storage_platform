"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { useWorkspace } from "@/lib/useWorkspace";
import { api } from "@v1/backend/convex/_generated/api";
import type { Id } from "@v1/backend/convex/_generated/dataModel";
import { Button } from "@v1/ui/button";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Check,
  Code,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function CredentialsPage() {
  const { current, workspaces } = useWorkspace();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<{
    accessKeyId: string;
    secretAccessKey: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const scoped = current ? { workspaceId: current } : "skip";
  const accounts = useQuery(api.storageAccounts.listAccounts, scoped);
  const credentials = useQuery(api.s3Credentials.listCredentials, scoped);

  const ensureDefaultAccount = useMutation(
    api.storageAccounts.ensureDefaultAccount,
  );
  const createCredential = useMutation(api.s3Credentials.createCredential);
  const revokeCredential = useMutation(api.s3Credentials.revokeCredential);
  const rotateCredential = useMutation(api.s3Credentials.rotateCredential);
  const myRole = workspaces.find((w) => w._id === current)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const handleRotate = async (id: Id<"s3Credentials">, name: string) => {
    try {
      const res = await rotateCredential({ id });
      setCreatedSecret({
        accessKeyId: res.accessKeyId,
        secretAccessKey: res.secretKey,
      });
      toast.success(`Credential "${name}" rotated — update your clients!`);
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to rotate credential");
    }
  };

  useEffect(() => {
    if (current && accounts && accounts.length === 0) {
      void ensureDefaultAccount({ workspaceId: current }).catch(() => {});
    }
  }, [current, accounts, ensureDefaultAccount]);

  const defaultAccount = accounts?.[0];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || !defaultAccount) {
      toast.error("No storage account found");
      return;
    }
    const cleanName = name.trim();
    if (!cleanName) return;

    setCreating(true);
    try {
      const res = await createCredential({
        workspaceId: current,
        accountId: defaultAccount._id,
        name: cleanName,
      });
      setName("");
      setCreatedSecret({
        accessKeyId: res.accessKeyId,
        secretAccessKey: res.secretKey,
      });
      toast.success("S3 Credentials generated successfully!");
    } catch (err: any) {
      toast.error(
        err?.data ?? err?.message ?? "Failed to create S3 credentials",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: Id<"s3Credentials">) => {
    try {
      await revokeCredential({ id });
      toast.success("Credential revoked");
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to revoke credential");
    }
  };

  const copy = (val: string, label: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
    toast.success(`Copied ${label}`);
  };

  if (!current) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-sm text-primary/60">
        Setting up workspace...
      </div>
    );
  }

  const s3GatewayEndpoint =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:${process.env.NEXT_PUBLIC_S3_GATEWAY_PORT ?? "3211"}/s3`
      : "http://127.0.0.1:3211/s3";

  return (
    <div className="flex h-full w-full bg-secondary px-6 py-8 dark:bg-black">
      <div className="mx-auto w-full max-w-screen-xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-medium text-primary">
            S3 API Credentials
          </h1>
          <p className="text-sm text-primary/60">
            Generate and manage AWS SigV4-compatible access keys to connect S3
            clients and tools to your storage.
          </p>
        </div>

        {/* Secret Display Banner (Shown once after generation) */}
        {createdSecret && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-5 text-primary">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-3 flex-1">
                <div>
                  <h3 className="text-sm font-semibold text-amber-500">
                    Save Your S3 Secret Access Key
                  </h3>
                  <p className="text-xs text-primary/70 mt-0.5">
                    This secret key will <strong>never be shown again</strong>.
                    Please copy and store it securely now.
                  </p>
                </div>

                <div className="space-y-2 rounded-md bg-background/80 p-3 font-mono text-xs border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-primary/60">Access Key ID:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-primary">
                        {createdSecret.accessKeyId}
                      </span>
                      <button
                        onClick={() =>
                          copy(createdSecret.accessKeyId, "Access Key ID")
                        }
                        className="text-primary/40 hover:text-primary"
                      >
                        {copiedKey === "Access Key ID" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-primary/60">Secret Access Key:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-emerald-500">
                        {createdSecret.secretAccessKey}
                      </span>
                      <button
                        onClick={() =>
                          copy(
                            createdSecret.secretAccessKey,
                            "Secret Access Key",
                          )
                        }
                        className="text-primary/40 hover:text-primary"
                      >
                        {copiedKey === "Secret Access Key" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCreatedSecret(null)}
                  className="text-xs"
                >
                  I have saved these credentials
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Generate Key Form */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-primary mb-3">
            Create New S3 Credential
          </h2>
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <input
              type="text"
              placeholder="Credential Name (e.g., Production AWS SDK, Backup CLI)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
            <Button
              type="submit"
              disabled={creating}
              className="shrink-0 gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {creating ? "Generating..." : "Generate Key"}
            </Button>
          </form>
        </div>

        {/* Credentials List */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-primary flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary/60" />
              Active S3 Credentials ({credentials?.length ?? 0})
            </h2>
          </div>
          <div className="divide-y divide-border/50">
            {credentials === undefined ? (
              <div className="p-8 text-center text-sm text-primary/40">
                Loading credentials...
              </div>
            ) : credentials.length === 0 ? (
              <div className="p-8 text-center">
                <Lock className="mx-auto h-8 w-8 text-primary/30 mb-2" />
                <p className="text-sm text-primary/60">
                  No API credentials generated yet.
                </p>
                <p className="text-xs text-primary/40 mt-1">
                  Create a credential above to access your buckets via the AWS
                  CLI or SDK.
                </p>
              </div>
            ) : (
              credentials.map((cred) => (
                <div
                  key={cred._id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-primary/[0.02]"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-primary">
                        {cred.name}
                      </span>
                      {cred.revoked ? (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          Revoked
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-primary/60">
                      <span>Access Key: {cred.accessKeyId}</span>
                      <button
                        onClick={() => copy(cred.accessKeyId, "Access Key")}
                        className="text-primary/40 hover:text-primary"
                        title="Copy Access Key ID"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <span>•</span>
                      <span>
                        Created: {new Date(cred.createdAt).toLocaleDateString()}
                      </span>
                      {cred.lastUsedAt && (
                        <>
                          <span>•</span>
                          <span>
                            Last Used:{" "}
                            {new Date(cred.lastUsedAt).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {!cred.revoked && (
                    <div className="flex items-center gap-2">
                      {canManage && (
                        <ConfirmButton
                          onConfirm={() => handleRotate(cred._id, cred.name)}
                          title="Rotate S3 Credential?"
                          description="A new secret is issued and the old one stops working immediately. Update every client using this key."
                          confirmLabel="Rotate"
                          label="Rotate"
                          className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-600 hover:bg-amber-500/20"
                        />
                      )}
                      <ConfirmButton
                        onConfirm={() => handleRevoke(cred._id)}
                        title="Revoke S3 Credential?"
                        description="This action immediately prevents any client using this access key from performing S3 operations."
                        confirmLabel="Revoke"
                        label="Revoke"
                        className="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20"
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Connection Guide */}
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="h-4 w-4 text-primary/70" />
            <h2 className="text-sm font-medium text-primary">
              AWS CLI & SDK Connection Guide
            </h2>
          </div>
          <p className="text-xs text-primary/60 mb-4">
            Connect to your S3 storage using any standard AWS tool by
            configuring the custom endpoint and your generated credentials.
          </p>

          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-primary/80">
                AWS CLI Command Example:
              </span>
              <pre className="mt-1.5 rounded-md bg-secondary/80 p-3 font-mono text-xs text-primary overflow-x-auto border border-border">
                {`# 1. Export credentials
export AWS_ACCESS_KEY_ID="<YOUR_ACCESS_KEY_ID>"
export AWS_SECRET_ACCESS_KEY="<YOUR_SECRET_ACCESS_KEY>"
export AWS_DEFAULT_REGION="us-east-1"

# 2. List your buckets
aws --endpoint-url="${s3GatewayEndpoint}" s3 ls

# 3. Upload a file
aws --endpoint-url="${s3GatewayEndpoint}" s3 cp ./file.txt s3://<BUCKET_NAME>/`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
