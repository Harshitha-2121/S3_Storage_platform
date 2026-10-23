"use client";

import { env } from "@/env.mjs";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const getConvexUrl = () => {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/convex`;
  }
  return env.NEXT_PUBLIC_CONVEX_URL;
};

const convex = new ConvexReactClient(getConvexUrl(), {
  verbose: false,
});

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
