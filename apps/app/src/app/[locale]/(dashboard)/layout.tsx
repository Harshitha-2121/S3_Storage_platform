import { WorkspaceProvider } from "@/lib/workspace-provider";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@v1/backend/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { CommandPalette } from "./_components/command-palette";
import { Sidebar } from "./_components/sidebar";
import { Topbar } from "./_components/topbar";

export default async function Layout({
  children,
}: { children: React.ReactNode }) {
  let user: any = null;
  try {
    user = await fetchQuery(
      api.users.getUser,
      {},
      { token: await convexAuthNextjsToken() },
    );
  } catch (err) {
    console.warn("fetchQuery(api.users.getUser) fallback:", err);
  }
  if (!user?.username) {
    return redirect("/onboarding");
  }
  return (
    <WorkspaceProvider>
      <div className="min-h-screen w-full bg-secondary dark:bg-black md:flex">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <div className="min-h-0 flex-1">{children}</div>
        </main>
      </div>
      <Toaster richColors position="top-right" />
      <CommandPalette />
    </WorkspaceProvider>
  );
}
