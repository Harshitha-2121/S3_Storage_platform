"use client";

import { api } from "@v1/backend/convex/_generated/api";
import type { Id } from "@v1/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { createContext, useContext, useEffect, useState } from "react";

type WS = { _id: Id<"workspaces">; name: string; role: string };
type Ctx = {
  workspaces: WS[];
  current: Id<"workspaces"> | null;
  select: (id: Id<"workspaces">) => void;
};

const WorkspaceCtx = createContext<Ctx>({ workspaces: [], current: null, select: () => {} });
export const useWorkspace = () => useContext(WorkspaceCtx);

/**
 * Holds the current workspace in React context (persisted to localStorage) so the sidebar
 * switcher and every page share it reactively — switching updates all consumers at once.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const workspaces = useQuery(api.orgs.myWorkspaces) as WS[] | undefined;
  const ensure = useMutation(api.orgs.ensureWorkspace);
  const [current, setCurrent] = useState<Id<"workspaces"> | null>(null);
  const [ensuring, setEnsuring] = useState(false);

  useEffect(() => {
    if (workspaces === undefined) return;
    if (workspaces.length === 0) {
      if (!ensuring) {
        setEnsuring(true);
        void ensure({}).finally(() => setEnsuring(false));
      }
      return;
    }
    setCurrent((prev) => {
      if (prev && workspaces.some((w) => w._id === prev)) return prev;
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("ws") : null;
      const match = workspaces.find((w) => w._id === saved);
      return match?._id ?? workspaces[0]?._id ?? prev;
    });
  }, [workspaces, ensure, ensuring]);

  const select = (id: Id<"workspaces">) => {
    if (typeof window !== "undefined") window.localStorage.setItem("ws", id);
    setCurrent(id);
  };

  return (
    <WorkspaceCtx.Provider value={{ workspaces: workspaces ?? [], current, select }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
