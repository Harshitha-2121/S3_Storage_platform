"use client";

import { api } from "@v1/backend/convex/_generated/api";
import { Button } from "@v1/ui/button";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

export function SessionsCard() {
  const sessions = useQuery(api.sessions.mySessions);
  const revokeSession = useMutation(api.sessions.revokeSession);
  const revokeOthers = useMutation(api.sessions.revokeOtherSessions);

  return (
    <div className="flex w-full flex-col items-start rounded-lg border border-border bg-card">
      <div className="flex w-full items-start justify-between p-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-medium text-primary">Active sessions</h2>
          <p className="text-sm font-normal text-primary/60">
            Devices currently signed in to your account.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const n = await revokeOthers({});
            toast.success(
              n === 0 ? "No other sessions" : `Signed out ${n} other session${n > 1 ? "s" : ""}`,
            );
          }}
        >
          Sign out other sessions
        </Button>
      </div>
      <div className="w-full divide-y divide-border/50 border-t border-border">
        {sessions === undefined ? (
          <p className="px-6 py-4 text-sm text-primary/40">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="px-6 py-4 text-sm text-primary/40">No sessions</p>
        ) : (
          sessions.map((s) => (
            <div
              key={s._id}
              className="flex items-center justify-between px-6 py-3 text-sm"
            >
              <span className="text-primary/70">
                Started {new Date(s.createdAt).toLocaleString()}
                {s.isCurrent && (
                  <span className="ml-2 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 ring-1 ring-inset ring-green-600/20">
                    this device
                  </span>
                )}
              </span>
              {!s.isCurrent && (
                <button
                  type="button"
                  className="text-xs text-red-500 underline"
                  onClick={async () => {
                    await revokeSession({ sessionId: s._id });
                    toast.success("Session revoked");
                  }}
                >
                  revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
