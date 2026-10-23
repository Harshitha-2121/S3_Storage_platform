"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@v1/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  HelpCircle,
  LogOut,
  Settings,
  User,
  KeyRound,
  Shield,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NotificationsBell } from "./notifications-bell";

const APP_VERSION = "0.1.0";
const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/buckets": "Buckets",
  "/credentials": "API Credentials",
  "/jobs": "Jobs",
  "/platform": "Platform",
  "/files": "Files",
  "/settings": "Settings",
  "/settings/billing": "Billing",
};

export function Topbar() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? "Dashboard";
  const user = useQuery(api.users.getUser);
  const { signOut } = useAuthActions();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <nav className="flex items-center gap-1.5 text-sm">
        <span className="text-primary/40">myos</span>
        <span className="text-primary/30">/</span>
        <span className="font-medium text-primary/80">{title}</span>
      </nav>
      <div className="flex items-center gap-4 text-xs text-primary/60">
        <NotificationsBell />
        <span className="hidden sm:inline text-primary/40 font-mono">v{APP_VERSION}</span>
        <a
          href="https://github.com/get-convex/v1/tree/main/docs"
          target="_blank"
          rel="noreferrer"
          className="hidden sm:flex items-center gap-1.5 hover:text-primary transition-colors text-primary/50"
        >
          <HelpCircle className="h-3.5 w-3.5" /> Help
        </a>

        {/* User Profile & Account Dropdown Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 rounded-full border border-border bg-background/50 px-2 py-1 text-left hover:border-primary/30 transition-all focus:outline-none"
          >
            {user?.avatarUrl ? (
              // biome-ignore lint/a11y/useAltText: decorative avatar
              <img src={user.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <span className="h-5 w-5 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-[10px] text-white font-medium">
                {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="hidden md:inline font-mono text-xs text-primary/80 max-w-[100px] truncate">
              {user?.name || user?.email?.split("@")[0] || "Account"}
            </span>
            <ChevronDown className="h-3 w-3 text-primary/40" />
          </button>

          {profileOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setProfileOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-md border border-border bg-card shadow-xl p-1.5 text-xs text-primary/80 divide-y divide-border/50">
                <div className="px-3 py-2">
                  <p className="font-semibold text-primary truncate">{user?.name || "User"}</p>
                  <p className="font-mono text-[11px] text-primary/50 truncate">{user?.email || "—"}</p>
                </div>
                <div className="py-1">
                  <Link
                    href="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-primary/5 transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5 text-primary/60" /> Account Settings
                  </Link>
                  <Link
                    href="/credentials"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-primary/5 transition-colors"
                  >
                    <KeyRound className="h-3.5 w-3.5 text-primary/60" /> S3 Credentials
                  </Link>
                  <Link
                    href="/platform"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-primary/5 transition-colors"
                  >
                    <Shield className="h-3.5 w-3.5 text-primary/60" /> Platform & Keys
                  </Link>
                </div>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      signOut();
                    }}
                    className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
