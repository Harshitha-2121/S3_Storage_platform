"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { useWorkspace } from "@/lib/useWorkspace";
import { api } from "@v1/backend/convex/_generated/api";
import { Button } from "@v1/ui/button";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { current } = useWorkspace();
  const {
    results: files,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.files.listPaged,
    current ? { workspaceId: current } : "skip",
    { initialNumItems: 20 },
  );
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveFile = useMutation(api.files.saveFile);
  const removeFile = useMutation(api.files.remove);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !current) return;
    setBusy(true);
    try {
      const url = await generateUploadUrl({ workspaceId: current });
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = await res.json();
      await saveFile({
        workspaceId: current,
        storageId,
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      });
      if (inputRef.current) inputRef.current.value = "";
      toast.success(`Uploaded ${file.name}`);
    } catch {
      toast.error("Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-secondary px-6 py-8 dark:bg-black">
      <div className="z-10 mx-auto w-full max-w-screen-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-medium text-primary">Files</h1>
            <p className="text-sm text-primary/60">
              Workspace-scoped uploads, stored in Convex file storage.
            </p>
          </div>
          <label className="cursor-pointer">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              disabled={busy || !current}
              onChange={onUpload}
            />
            <span
              className={`inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm ${
                busy ? "opacity-60" : ""
              }`}
            >
              {busy ? "Uploading…" : "Upload file"}
            </span>
          </label>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-primary/60">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {status === "LoadingFirstPage" && (
                <tr>
                  <td className="px-4 py-6 text-primary/40" colSpan={4}>
                    Loading…
                  </td>
                </tr>
              )}
              {status !== "LoadingFirstPage" && files.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-primary/40" colSpan={4}>
                    No files yet — click “Upload file”.
                  </td>
                </tr>
              )}
              {files.map((f) => (
                <tr
                  key={f._id}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="px-4 py-3">
                    {f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary/80 underline"
                      >
                        {f.name}
                      </a>
                    ) : (
                      <span className="text-primary/80">{f.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-primary/60">{fmtSize(f.size)}</td>
                  <td className="px-4 py-3 text-primary/50">
                    {new Date(f.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ConfirmButton
                      label="delete"
                      title="Delete file?"
                      description={f.name}
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        await removeFile({ fileId: f._id });
                        toast.success("File deleted");
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {status === "CanLoadMore" && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" size="sm" onClick={() => loadMore(20)}>
              Load more
            </Button>
          </div>
        )}
        {status === "LoadingMore" && (
          <p className="mt-4 text-center text-sm text-primary/40">Loading…</p>
        )}
      </div>
    </div>
  );
}
