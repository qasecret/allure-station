import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";

/** Frame for all routes: persistent sidebar + a per-page topbar (rendered by each page). */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">{children}</div>
    </div>
  );
}
