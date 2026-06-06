import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { createClient } from "./api/client.js";
import { Projects } from "./pages/Projects.js";
import { Project } from "./pages/Project.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { applyTheme, getTheme } from "./theme.js";
import "./styles.css";

export const api = createClient(import.meta.env.VITE_API_BASE ?? "/api");
const qc = new QueryClient();

applyTheme(getTheme()); // restore the saved theme before first paint

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeToggle />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Projects />} />
          <Route path="/projects/:id" element={<Project />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
