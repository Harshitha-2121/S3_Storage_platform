"use client";

import { api } from "@v1/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Bell } from "lucide-react";
import { useState } from "react";

export function NotificationsBell() {
  const notifications = useQuery(api.notifications.myNotifications);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const markAllRead = useMutation(api.notifications.markAllRead);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-primary/50 hover:bg-primary/5 hover:text-primary"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && unread > 0) void markAllRead();
        }}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-medium text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-md border border-border bg-card shadow-lg">
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-primary">
              Notifications
            </div>
            <div className="max-h-80 divide-y divide-border/50 overflow-y-auto">
              {notifications?.length ? (
                notifications.map((n) => (
                  <div key={n._id} className="px-3 py-2 text-sm">
                    <p className="font-medium text-primary/80">{n.title}</p>
                    {n.body && <p className="text-xs text-primary/50">{n.body}</p>}
                    <p className="mt-0.5 text-[10px] text-primary/30">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-primary/40">
                  No notifications
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
