"use client";

import { HelpCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { NotificationsBell } from "./notifications-bell";

const APP_VERSION = "0.1.0";
const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/jobs": "Jobs",
  "/platform": "Platform",
  "/files": "Files",
  "/settings": "Settings",
  "/settings/billing": "Billing",
};

export function Topbar() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? "Dashboard";
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <nav className="flex items-center gap-1.5 text-sm">
        <span className="text-primary/40">myos</span>
        <span className="text-primary/30">/</span>
        <span className="font-medium text-primary/80">{title}</span>
      </nav>
      <div className="flex items-center gap-3 text-xs text-primary/40">
        <NotificationsBell />
        <span className="hidden sm:inline">v{APP_VERSION}</span>
        <a
          href="https://github.com/get-convex/v1/tree/main/docs"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 hover:text-primary"
        >
          <HelpCircle className="h-4 w-4" /> Help
        </a>
      </div>
    </header>
  );
}
