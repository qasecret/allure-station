import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "./api/client.js";
import { Projects } from "./pages/Projects.js";
import { Project } from "./pages/Project.js";
import { ProjectSettings } from "./pages/ProjectSettings.js";
import { Login } from "./pages/Login.js";
import { Users } from "./pages/Users.js";
import { Audit } from "./pages/Audit.js";
import { Account } from "./pages/Account.js";
import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "./auth.js";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyTheme, getTheme } from "./theme.js";
import { ApiError } from "./lib/errors.js";
import "./styles.css";

export const api = createClient(import.meta.env.VITE_API_BASE ?? "/api");
// Deterministic 4xx errors are never retried; transient network/5xx failures are retried once.
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
    mutations: { retry: 0 },
  },
});

applyTheme(getTheme());
if (typeof matchMedia !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <TooltipProvider delayDuration={300}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<AppShell><Outlet /></AppShell>}>
                  <Route path="/" element={<Projects />} />
                  <Route path="/projects/:id" element={<Project />} />
                  <Route path="/projects/:id/settings" element={<ProjectSettings />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/audit" element={<Audit />} />
                  <Route path="/account" element={<Account />} />
                </Route>
              </Routes>
            </TooltipProvider>
            <Toaster richColors position="top-right" />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
);
