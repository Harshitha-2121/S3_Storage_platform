"use client";

import { useWorkspace } from "@/lib/useWorkspace";
import { api } from "@v1/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { Activity, Boxes, FileText, ListChecks, Users } from "lucide-react";
import { useState } from "react";

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-primary/50">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-primary">{value ?? "—"}</p>
      {sub && <p className="mt-0.5 text-xs text-primary/40">{sub}</p>}
    </div>
  );
}

function fmtBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function Home() {
  const { current } = useWorkspace();
  const scoped = current ? { workspaceId: current } : "skip";
  const stats = useQuery(api.dashboard.stats, scoped);
  const audit = useQuery(api.audit.recent, scoped);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const ACTIVITY_PREVIEW = 5;
  const visibleAudit =
    audit && !activityExpanded ? audit.slice(0, ACTIVITY_PREVIEW) : audit;

  return (
    <div className="flex h-full w-full bg-secondary px-6 py-8 dark:bg-black">
      <div className="mx-auto w-full max-w-screen-xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-medium text-primary">S3 Cloud Storage Dashboard</h1>
            <p className="text-sm text-primary/60">
              Multi-tenant object storage platform powered by Convex and RustFS.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            icon={Boxes}
            label="S3 Buckets"
            value={stats?.buckets}
            sub={`${stats?.storageAccounts ?? 1} storage account`}
          />
          <Stat
            icon={FileText}
            label="Stored Objects"
            value={stats?.storageObjects}
            sub={`${stats?.files ?? 0} direct files`}
          />
          <Stat
            icon={Activity}
            label="Stored Volume"
            value={stats ? (stats.storageBytes as any) : undefined}
            sub={fmtBytes(stats?.storageBytes ?? 0)}
          />
          <Stat
            icon={Users}
            label="Workspace Members"
            value={stats?.members}
            sub={`${stats?.openJobs ?? 0} active jobs`}
          />
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Activity className="h-4 w-4 text-primary/50" />
            <h2 className="text-sm font-medium text-primary">Recent activity</h2>
          </div>
          <div className="divide-y divide-border/50">
            {visibleAudit === undefined ? (
              <div className="px-4 py-6 text-sm text-primary/40">Loading…</div>
            ) : visibleAudit.length ? (
              visibleAudit.map((a) => (
                <div
                  key={a._id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="font-mono text-primary/80">{a.action}</span>
                  <span className="text-primary/50">
                    {new Date(a.at).toLocaleString()}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-primary/40">
                No activity yet
              </div>
            )}
            {audit && audit.length > ACTIVITY_PREVIEW && (
              <button
                onClick={() => setActivityExpanded((v) => !v)}
                className="w-full px-4 py-2.5 text-center text-xs font-medium text-primary/60 hover:text-primary"
              >
                {activityExpanded
                  ? "Show less"
                  : `See more (${audit.length - ACTIVITY_PREVIEW} more)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
