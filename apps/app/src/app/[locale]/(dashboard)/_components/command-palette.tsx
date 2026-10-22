"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const COMMANDS = [
  { label: "Dashboard", href: "/" },
  { label: "Jobs", href: "/jobs" },
  { label: "Platform", href: "/platform" },
  { label: "Files", href: "/files" },
  { label: "Settings", href: "/settings" },
  { label: "Billing", href: "/settings/billing" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(q.toLowerCase()),
  );
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-32">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={() => setOpen(false)}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <input
          // biome-ignore lint/a11y/noAutofocus: palette focus is expected
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered[0]) go(filtered[0].href);
          }}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length ? (
            filtered.map((c) => (
              <button
                key={c.href}
                type="button"
                onClick={() => go(c.href)}
                className="block w-full rounded px-3 py-2 text-left text-sm text-primary/80 hover:bg-primary/10"
              >
                {c.label}
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-sm text-primary/40">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}
