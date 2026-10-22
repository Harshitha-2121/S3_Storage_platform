"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { useWorkspace } from "@/lib/useWorkspace";
import { api } from "@v1/backend/convex/_generated/api";
import type { Id } from "@v1/backend/convex/_generated/dataModel";
import { Button } from "@v1/ui/button";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Copy,
  Database,
  Download,
  File,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function getFileIcon(contentType?: string, name?: string) {
  if (contentType?.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(name || "")) {
    return ImageIcon;
  }
  if (contentType?.includes("pdf") || contentType?.includes("text") || /\.(txt|pdf|md|json)$/i.test(name || "")) {
    return FileText;
  }
  return File;
}

export default function BucketDetailPage() {
  const params = useParams();
  const bucketId = params?.id as Id<"buckets">;
  const { current } = useWorkspace();

  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bucket = useQuery(api.buckets.getBucket, bucketId ? { id: bucketId } : "skip");
  const listObjects = useAction(api.objects.listObjects);
  const [objectsData, setObjectsData] = useState<{
    objects: { key: string; size: number; etag?: string; contentType?: string }[];
  } | undefined>(undefined);

  const createUploadUrl = useMutation(api.objects.createUploadUrl);
  const completeUpload = useAction(api.objects.completeUpload);
  const createDownloadUrl = useAction(api.objects.createDownloadUrl);
  const deleteObject = useAction(api.objects.deleteObject);
  const copyObject = useAction(api.objects.copyObject);
  const renameObject = useAction(api.objects.renameObject);

  const refreshObjects = async () => {
    if (!bucketId) return;
    try {
      const res = await listObjects({ bucketId, maxKeys: 100 });
      setObjectsData(res as typeof objectsData);
    } catch {
      // list failures surface via toast on the triggering action
    }
  };

  useEffect(() => {
    void refreshObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !bucketId) return;

    setUploading(true);
    const key = file.name.replace(/\s+/g, "_");
    const contentType = file.type || "application/octet-stream";

    try {
      // 1. Obtain presigned URL from backend
      const { url } = await createUploadUrl({
        bucketId,
        key,
        contentType,
        size: file.size,
      });

      // 2. Direct upload to RustFS via presigned URL
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: file,
      });

      if (!res.ok) {
        throw new Error(`Upload failed with status ${res.status}`);
      }

      // 3. Complete and record metadata in Convex
      await completeUpload({
        bucketId,
        key,
        contentType,
      });

      toast.success(`Uploaded "${key}" successfully!`);
      await refreshObjects();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (key: string) => {
    try {
      const { url } = await createDownloadUrl({
        bucketId,
        key,
      });
      window.open(url, "_blank");
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to generate download URL");
    }
  };

  const handleDeleteObject = async (key: string) => {
    try {
      await deleteObject({ bucketId, key });
      await refreshObjects();
      toast.success(`Deleted object "${key}"`);
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to delete object");
    }
  };

  const handleCopyObject = async (key: string) => {
    try {
      const dest = window.prompt("Copy to (new key name)", key);
      if (dest === null) return; // Cancelled: copy nothing
      const clean = dest.trim().replace(/\s+/g, "_");
      if (!clean) {
        toast.error("Please enter a destination key");
        return;
      }
      if (clean === key) {
        toast.error("Destination must differ from the source key");
        return;
      }
      await copyObject({ bucketId, key, destBucketId: bucketId, destKey: clean });
      await refreshObjects();
      toast.success(`Copied "${key}" to "${clean}"`);
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to copy object");
    }
  };

  const handleRenameObject = async (key: string) => {
    try {
      const dest = window.prompt("Rename to", key);
      if (dest === null) return; // Cancelled: rename nothing
      const clean = dest.trim().replace(/\s+/g, "_");
      if (!clean) {
        toast.error("Please enter a new key name");
        return;
      }
      if (clean === key) return; // unchanged: nothing to do
      await renameObject({ bucketId, key, destKey: clean });
      await refreshObjects();
      toast.success(`Renamed "${key}" to "${clean}"`);
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Failed to rename object");
    }
  };

  if (!bucket) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-sm text-primary/60">
        Loading bucket details...
      </div>
    );
  }

  const objects = objectsData?.objects || [];
  const filteredObjects = objects.filter((o) =>
    o.key.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full w-full bg-secondary px-6 py-8 dark:bg-black">
      <div className="mx-auto w-full max-w-screen-xl space-y-6">
        {/* Navigation & Header */}
        <div>
          <Link
            href="/buckets"
            className="inline-flex items-center gap-1.5 text-xs text-primary/60 hover:text-primary mb-3"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Buckets
          </Link>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="rounded-md border border-border bg-card p-2">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="font-mono text-xl font-medium text-primary">{bucket.name}</h1>
                <p className="font-mono text-xs text-primary/50">
                  Target: {bucket.rustfsName} • Created {new Date(bucket.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-1.5"
              >
                <UploadCloud className="h-4 w-4" />
                {uploading ? "Uploading..." : "Upload Object"}
              </Button>
            </div>
          </div>
        </div>

        {/* Bucket Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <span className="text-[11px] font-medium uppercase tracking-wider text-primary/50">
              Objects Count
            </span>
            <p className="mt-1 font-mono text-xl font-semibold text-primary">
              {bucket.usage?.objects ?? objects.length}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <span className="text-[11px] font-medium uppercase tracking-wider text-primary/50">
              Total Stored Bytes
            </span>
            <p className="mt-1 font-mono text-xl font-semibold text-primary">
              {fmtBytes(bucket.usage?.bytes ?? 0)}
            </p>
          </div>
          <div className="col-span-2 sm:col-span-1 rounded-lg border border-border bg-card p-4">
            <span className="text-[11px] font-medium uppercase tracking-wider text-primary/50">
              Storage Engine
            </span>
            <p className="mt-1 font-mono text-xl font-semibold text-emerald-500">
              RustFS S3
            </p>
          </div>
        </div>

        {/* Objects Browser */}
        <div className="rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary/60" />
              <h2 className="text-sm font-medium text-primary">Objects ({objects.length})</h2>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-primary/40" />
              <input
                type="text"
                placeholder="Search objects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-primary placeholder:text-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="divide-y divide-border/50">
            {objectsData === undefined ? (
              <div className="p-8 text-center text-sm text-primary/40">Loading objects from RustFS...</div>
            ) : filteredObjects.length === 0 ? (
              <div className="p-8 text-center">
                <File className="mx-auto h-8 w-8 text-primary/30 mb-2" />
                <p className="text-sm text-primary/60">No objects found</p>
                <p className="text-xs text-primary/40 mt-1">Upload a file to this bucket using the button above.</p>
              </div>
            ) : (
              filteredObjects.map((obj) => {
                const Icon = getFileIcon(obj.contentType, obj.key);
                return (
                  <div
                    key={obj.key}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-primary/[0.02]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-md border border-border bg-secondary/50 p-2 text-primary/60">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-mono text-sm font-medium text-primary">{obj.key}</p>
                        <p className="font-mono text-xs text-primary/50">
                          {fmtBytes(obj.size)} • {obj.contentType || "binary"} • ETag: {obj.etag?.replace(/"/g, "")}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(obj.key)}
                        className="gap-1.5 text-xs"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyObject(obj.key)}
                        className="gap-1.5 text-xs"
                        title="Copy object to a new key"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRenameObject(obj.key)}
                        className="gap-1.5 text-xs"
                        title="Rename object"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </Button>
                      <ConfirmButton
                        onConfirm={() => handleDeleteObject(obj.key)}
                        title="Delete Object?"
                        description={`Are you sure you want to delete "${obj.key}"? This action cannot be undone.`}
                        confirmLabel="Delete"
                        label={<Trash2 className="h-3.5 w-3.5 text-destructive" />}
                        className="rounded-md border border-destructive/20 bg-destructive/10 p-2 hover:bg-destructive/20"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
