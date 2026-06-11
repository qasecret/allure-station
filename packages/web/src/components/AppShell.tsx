import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";

/** Frame for all routes: persistent sidebar + a per-page topbar (rendered by each page). */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  // Move focus to the content region on route change so screen-reader users land on the new page.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    mainRef.current?.focus();
  }, [pathname]);
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Skip to main content
      </a>
      <Sidebar />
      <div id="main-content" ref={mainRef} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">{children}</div>
    </div>
  );
}
