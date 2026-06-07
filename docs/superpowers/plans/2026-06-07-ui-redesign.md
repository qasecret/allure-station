# Allure Station UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Allure Station shell (`packages/web`) as a clean, modern, Allure-native SaaS dashboard using Tailwind + shadcn/ui, without changing any API or behavior.

**Architecture:** Add a Tailwind + shadcn/ui design system with CSS-variable tokens (teal brand, violet primary, status colors). Wrap all routes in an `AppShell` (collapsible sidebar + slim topbar). Redesign every surface — Projects dashboard, Project workspace (report iframe untouched), a new `/projects/:id/settings` page, Login, Users, Audit. Dark mode keeps the existing `system/light/dark` model, retargeted to shadcn's `.dark` class.

**Tech Stack:** React 18, Vite 5, TanStack Query, React Router 6, Tailwind CSS 3, shadcn/ui (Radix), lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-ui-redesign-design.md`

**Conventions for every task:**
- Work in `packages/web`. Run commands with `pnpm --filter @allure-station/web <script>`.
- After any code change, the task's final verification is: `pnpm --filter @allure-station/web typecheck` passes, `pnpm --filter @allure-station/web build` passes, and `pnpm --filter @allure-station/web test` passes.
- Pure-logic helpers get vitest unit tests (node env — no DOM). Visual components are verified by typecheck/build + the Playwright screenshot pass in Slice 6. Do **not** add React Testing Library.
- Commit after each task with the message shown.

---

## File Structure

**New foundation:**
- `packages/web/tailwind.config.ts` — Tailwind config + token → utility mapping
- `packages/web/postcss.config.js` — PostCSS (tailwind + autoprefixer)
- `packages/web/components.json` — shadcn config
- `packages/web/src/lib/utils.ts` — `cn()` helper
- `packages/web/src/lib/format.ts` — `relativeTime()`, `passRate()` pure helpers (+ tests)
- `packages/web/src/components/ui/*` — shadcn primitives (generated)

**New app components:**
- `packages/web/src/components/AppShell.tsx` — layout frame (sidebar + topbar + outlet)
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/components/Topbar.tsx`
- `packages/web/src/components/UserMenu.tsx` — identity + theme + sign out
- `packages/web/src/components/PassRateDonut.tsx`
- `packages/web/src/components/Sparkline.tsx`
- `packages/web/src/components/ProjectCard.tsx`
- `packages/web/src/components/RunSelector.tsx`
- `packages/web/src/components/UploadDialog.tsx`
- `packages/web/src/components/NewProjectDialog.tsx`
- `packages/web/src/components/EmptyState.tsx`
- `packages/web/src/components/StatusBadge.tsx`

**Modified:**
- `packages/web/package.json` — deps
- `packages/web/vite.config.ts` — `@/` alias
- `packages/web/tsconfig.json` — `@/` path
- `packages/web/src/styles.css` — token layer (replaces ad-hoc vars)
- `packages/web/src/theme.ts` — target `.dark` class
- `packages/web/src/main.tsx` — mount AppShell + new route + Toaster
- `packages/web/src/pages/Projects.tsx`, `Project.tsx`, `Login.tsx`, `Users.tsx`, `Audit.tsx`
- New: `packages/web/src/pages/ProjectSettings.tsx`

**Retired:** `packages/web/src/components/TopBar.tsx`, `packages/web/src/components/ThemeToggle.tsx` (logic folded into Sidebar/UserMenu).

---

# Slice 0 — Foundation

### Task 0.1: Install Tailwind + shadcn dependencies

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Add dependencies**

Run from repo root:
```bash
pnpm --filter @allure-station/web add class-variance-authority clsx tailwind-merge lucide-react tailwindcss-animate sonner
pnpm --filter @allure-station/web add -D tailwindcss@3 postcss autoprefixer @types/node
```

- [ ] **Step 2: Verify install**

Run: `pnpm --filter @allure-station/web exec tailwindcss --help`
Expected: Tailwind CLI help prints (no error).

- [ ] **Step 3: Commit**

```bash
git add packages/web/package.json ../../pnpm-lock.yaml 2>/dev/null; git add packages/web/package.json pnpm-lock.yaml
git commit -m "build(web): add tailwind + shadcn/ui dependencies"
```

---

### Task 0.2: Configure PostCSS, Tailwind, and the `@/` alias

**Files:**
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/tailwind.config.ts`
- Modify: `packages/web/vite.config.ts`
- Modify: `packages/web/tsconfig.json`
- Create: `packages/web/src/lib/utils.ts`

- [ ] **Step 1: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 2: Create `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        // Allure brand + status (fixed, theme-independent)
        brand: { DEFAULT: "#12B58F", light: "#1ED6B2", dark: "#0A916F" },
        status: { pass: "#22C55E", fail: "#EF4444", broken: "#F59E0B", skip: "#94A3B8" },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: { "accordion-down": "accordion-down 0.2s ease-out", "accordion-up": "accordion-up 0.2s ease-out" },
    },
  },
  plugins: [animate],
} satisfies Config;
```

- [ ] **Step 3: Add `@/` alias to `vite.config.ts`**

Replace the file with:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": "http://localhost:5050" } },
});
```

- [ ] **Step 4: Add `@/` path to `tsconfig.json`**

Replace `compilerOptions` so the file reads:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 5: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS (no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/web/postcss.config.js packages/web/tailwind.config.ts packages/web/vite.config.ts packages/web/tsconfig.json packages/web/src/lib/utils.ts
git commit -m "build(web): configure tailwind, postcss, and @/ alias"
```

---

### Task 0.3: Token layer in `styles.css` + dark-mode retarget

**Files:**
- Modify: `packages/web/src/styles.css`
- Modify: `packages/web/src/theme.ts`

- [ ] **Step 1: Replace `styles.css` entirely**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    color-scheme: light dark;
    --radius: 0.625rem;

    --background: 210 20% 99%;
    --foreground: 222 22% 12%;
    --card: 0 0% 100%;
    --card-foreground: 222 22% 12%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 22% 12%;

    /* violet — Allure-native interactive accent */
    --primary: 255 92% 68%;
    --primary-foreground: 0 0% 100%;

    --secondary: 220 16% 96%;
    --secondary-foreground: 222 22% 20%;
    --muted: 220 16% 96%;
    --muted-foreground: 220 9% 46%;
    --accent: 220 16% 95%;
    --accent-foreground: 222 22% 18%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;

    --border: 220 16% 90%;
    --input: 220 16% 90%;
    --ring: 255 92% 68%;
  }

  .dark {
    --background: 222 24% 8%;
    --foreground: 210 16% 92%;
    --card: 222 22% 11%;
    --card-foreground: 210 16% 92%;
    --popover: 222 22% 11%;
    --popover-foreground: 210 16% 92%;

    --primary: 255 92% 72%;
    --primary-foreground: 222 24% 8%;

    --secondary: 222 18% 16%;
    --secondary-foreground: 210 16% 88%;
    --muted: 222 18% 16%;
    --muted-foreground: 218 12% 60%;
    --accent: 222 18% 18%;
    --accent-foreground: 210 16% 90%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 100%;

    --border: 222 16% 20%;
    --input: 222 16% 20%;
    --ring: 255 92% 72%;
  }

  * { @apply border-border; }
  body { @apply bg-background text-foreground; font-family: system-ui, -apple-system, sans-serif; }
}
```

- [ ] **Step 2: Retarget `theme.ts` to the `.dark` class**

Replace `applyTheme` in `src/theme.ts` so dark mode toggles the `dark` class (shadcn convention) instead of `data-theme`:
```ts
/** Apply the theme to <html>: toggles the `dark` class. "system" follows prefers-color-scheme. */
export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const dark = t === "dark" || (t === "system" &&
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  el.classList.toggle("dark", dark);
}
```

Keep `getTheme`/`setTheme`/`Theme` as-is.

- [ ] **Step 3: Make "system" reactive to OS changes**

In `src/main.tsx`, just below the existing `applyTheme(getTheme());` line, add:
```ts
if (typeof matchMedia !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS — Tailwind compiles, dist emitted.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles.css packages/web/src/theme.ts packages/web/src/main.tsx
git commit -m "feat(web): token-based theme layer with class-based dark mode"
```

---

### Task 0.4: Initialize shadcn and add base primitives

**Files:**
- Create: `packages/web/components.json`
- Create: `packages/web/src/components/ui/*`

- [ ] **Step 1: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" }
}
```

- [ ] **Step 2: Add primitives via the shadcn CLI**

Run from `packages/web`:
```bash
pnpm --filter @allure-station/web exec shadcn@latest add --yes button input card dialog sheet dropdown-menu select table badge tabs tooltip skeleton avatar scroll-area sonner separator label
```
If the CLI is not resolvable, run `pnpm dlx shadcn@latest add --yes <same list>` from `packages/web`.
Expected: files appear under `src/components/ui/`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS. If any generated file imports `@/lib/utils` and fails, confirm Task 0.2 alias steps are applied.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components.json packages/web/src/components/ui
git commit -m "feat(web): add shadcn/ui base primitives"
```

---

### Task 0.5: Pure formatting helpers (with tests)

**Files:**
- Create: `packages/web/src/lib/format.ts`
- Test: `packages/web/src/lib/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { passRate, relativeTime } from "./format.js";

describe("passRate", () => {
  it("returns rounded percent passed/total", () => {
    expect(passRate({ passed: 7, total: 8 })).toBe(88);
    expect(passRate({ passed: 0, total: 0 })).toBe(0);
    expect(passRate({ passed: 3, total: 3 })).toBe(100);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-07T12:00:00Z").getTime();
  it("formats recent times", () => {
    expect(relativeTime("2026-06-07T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-06-07T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-07T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-06-05T12:00:00Z", now)).toBe("2d ago");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @allure-station/web test src/lib/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `format.ts`**

```ts
export function passRate(stats: { passed: number; total: number }): number {
  if (!stats.total) return 0;
  return Math.round((stats.passed / stats.total) * 100);
}

/** Compact relative time. `now` is injectable for testing. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @allure-station/web test src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/format.ts packages/web/src/lib/format.test.ts
git commit -m "feat(web): passRate + relativeTime helpers"
```

---

# Slice 1 — App Shell

### Task 1.1: PassRateDonut + StatusBadge primitives

**Files:**
- Create: `packages/web/src/components/PassRateDonut.tsx`
- Create: `packages/web/src/components/StatusBadge.tsx`
- Test: `packages/web/src/components/PassRateDonut.geometry.test.ts`

- [ ] **Step 1: Write the failing geometry test**

```ts
import { describe, it, expect } from "vitest";
import { donutDash } from "./PassRateDonut.js";

describe("donutDash", () => {
  it("computes stroke-dasharray for the passed arc", () => {
    const c = 2 * Math.PI * 16;
    expect(donutDash(100, 16).dash).toBeCloseTo(c, 3);
    expect(donutDash(0, 16).dash).toBeCloseTo(0, 3);
    expect(donutDash(50, 16).dash).toBeCloseTo(c / 2, 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @allure-station/web test src/components/PassRateDonut.geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PassRateDonut.tsx`**

```tsx
import { cn } from "@/lib/utils";

/** Exported for testing: arc length for `pct`% of a circle radius `r`. */
export function donutDash(pct: number, r: number): { dash: number; circ: number } {
  const circ = 2 * Math.PI * r;
  return { dash: (Math.max(0, Math.min(100, pct)) / 100) * circ, circ };
}

export function PassRateDonut({ pct, size = 88, className }: { pct: number; size?: number; className?: string }) {
  const r = size / 2 - 8;
  const { dash, circ } = donutDash(pct, r);
  const color = pct >= 90 ? "#22C55E" : pct >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${pct}% passed`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} className="stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} stroke={color}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ - dash}`} />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @allure-station/web test src/components/PassRateDonut.geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `StatusBadge.tsx`**

```tsx
import { CheckCircle2, XCircle, Loader2, Clock, AlertTriangle } from "lucide-react";
import type { RunStatus } from "@allure-station/shared";
import { Badge } from "@/components/ui/badge";

const MAP: Record<RunStatus, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  ready: { label: "Ready", icon: CheckCircle2, cls: "bg-status-pass/15 text-status-pass border-status-pass/30" },
  failed: { label: "Failed", icon: XCircle, cls: "bg-status-fail/15 text-status-fail border-status-fail/30" },
  generating: { label: "Generating", icon: Loader2, cls: "bg-status-broken/15 text-status-broken border-status-broken/30" },
  pending: { label: "Pending", icon: Clock, cls: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const m = MAP[status] ?? { label: status, icon: AlertTriangle, cls: "bg-muted text-muted-foreground" };
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={m.cls}>
      <Icon className={status === "generating" ? "size-3 animate-spin" : "size-3"} />
      {m.label}
    </Badge>
  );
}
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/PassRateDonut.tsx packages/web/src/components/PassRateDonut.geometry.test.ts packages/web/src/components/StatusBadge.tsx
git commit -m "feat(web): PassRateDonut + StatusBadge components"
```

---

### Task 1.2: UserMenu (identity + theme + sign out)

**Files:**
- Create: `packages/web/src/components/UserMenu.tsx`

- [ ] **Step 1: Implement `UserMenu.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Monitor, Sun, Moon, ChevronsUpDown } from "lucide-react";
import { useAuth } from "@/auth";
import { getTheme, setTheme, type Theme } from "@/theme";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES: { key: Theme; label: string; icon: typeof Sun }[] = [
  { key: "system", label: "System", icon: Monitor },
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
];

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setT] = useState<Theme>(getTheme());

  const themeRow = (
    <div className="flex gap-1 px-2 py-1.5">
      {THEMES.map(({ key, label, icon: Icon }) => (
        <Button key={key} variant={theme === key ? "secondary" : "ghost"} size="sm"
          className="flex-1 h-7" aria-label={label} title={label}
          onClick={() => { setT(key); setTheme(key); }}>
          <Icon className="size-3.5" />
        </Button>
      ))}
    </div>
  );

  if (!user) {
    return (
      <div className="space-y-1">
        {themeRow}
        <Button variant="default" className="w-full" onClick={() => navigate("/login")}>Sign in</Button>
      </div>
    );
  }

  const initials = user.email.slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2 px-2 h-auto py-2">
          <Avatar className="size-7"><AvatarFallback className="text-xs bg-primary/10 text-primary">{initials}</AvatarFallback></Avatar>
          <span className="flex-1 truncate text-left text-sm">{user.email}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themeRow}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={async () => { await logout(); navigate("/"); }}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/UserMenu.tsx
git commit -m "feat(web): UserMenu with theme switcher and sign out"
```

---

### Task 1.3: Sidebar + Topbar + AppShell

**Files:**
- Create: `packages/web/src/components/Sidebar.tsx`
- Create: `packages/web/src/components/Topbar.tsx`
- Create: `packages/web/src/components/AppShell.tsx`

- [ ] **Step 1: Implement `Sidebar.tsx`**

```tsx
import { NavLink } from "react-router-dom";
import { LayoutGrid, Users, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground");

export function SidebarContent() {
  const { user } = useAuth();
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <NavLink to="/" className="flex items-center gap-2 px-2 py-2">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span className="font-semibold tracking-tight">Allure Station</span>
      </NavLink>
      <nav className="flex flex-col gap-1">
        <NavLink to="/" end className={linkCls}><LayoutGrid className="size-4" /> Projects</NavLink>
        {user?.role === "admin" && <NavLink to="/users" className={linkCls}><Users className="size-4" /> Users</NavLink>}
        {user?.role === "admin" && <NavLink to="/audit" className={linkCls}><ScrollText className="size-4" /> Audit</NavLink>}
      </nav>
      <div className="mt-auto"><UserMenu /></div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:block">
      <SidebarContent />
    </aside>
  );
}
```

- [ ] **Step 2: Implement `Topbar.tsx`**

```tsx
import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/Sidebar";

export function Topbar({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><Menu className="size-5" /></Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
```

- [ ] **Step 3: Implement `AppShell.tsx`**

```tsx
import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";

/** Frame for all routes: persistent sidebar + a per-page topbar passed as children's responsibility. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx packages/web/src/components/Topbar.tsx packages/web/src/components/AppShell.tsx
git commit -m "feat(web): AppShell with sidebar + responsive topbar"
```

---

### Task 1.4: Wire the shell into `main.tsx` (+ Toaster, settings route)

**Files:**
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: Rewrite the render tree**

Replace the `createRoot(...).render(...)` block and imports so it reads:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "./api/client.js";
import { Projects } from "./pages/Projects.js";
import { Project } from "./pages/Project.js";
import { ProjectSettings } from "./pages/ProjectSettings.js";
import { Login } from "./pages/Login.js";
import { Users } from "./pages/Users.js";
import { Audit } from "./pages/Audit.js";
import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "./auth.js";
import { applyTheme, getTheme } from "./theme.js";
import "./styles.css";

export const api = createClient(import.meta.env.VITE_API_BASE ?? "/api");
const qc = new QueryClient();

applyTheme(getTheme());
if (typeof matchMedia !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AppShell><Routes>
              <Route path="/" element={<Projects />} />
              <Route path="/projects/:id" element={<Project />} />
              <Route path="/projects/:id/settings" element={<ProjectSettings />} />
              <Route path="/users" element={<Users />} />
              <Route path="/audit" element={<Audit />} />
            </Routes></AppShell>} path="*" />
          </Routes>
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

Note: the existing `matchMedia` listener added in Task 0.3 Step 3 is now part of this block — do not duplicate it.

- [ ] **Step 2: Create a placeholder `ProjectSettings.tsx` so the import resolves**

Create `src/pages/ProjectSettings.tsx`:
```tsx
export function ProjectSettings() {
  return <div className="p-6">Settings (coming in Slice 4)</div>;
}
```

- [ ] **Step 3: Delete retired components**

```bash
git rm packages/web/src/components/TopBar.tsx packages/web/src/components/ThemeToggle.tsx
```

- [ ] **Step 4: Verify build + run dev smoke**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS. The sidebar renders, theme toggle in the user menu works, admin links gate on role.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/main.tsx packages/web/src/pages/ProjectSettings.tsx
git commit -m "feat(web): mount AppShell, Toaster, and settings route"
```

---

# Slice 2 — Projects Dashboard

### Task 2.1: Sparkline + EmptyState + NewProjectDialog

**Files:**
- Create: `packages/web/src/components/Sparkline.tsx`
- Create: `packages/web/src/components/EmptyState.tsx`
- Create: `packages/web/src/components/NewProjectDialog.tsx`

- [ ] **Step 1: Implement `Sparkline.tsx`**

```tsx
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 80, h = 24, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} className={className} role="img" aria-label="pass-rate trend">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Implement `EmptyState.tsx`**

```tsx
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-muted"><Icon className="size-6 text-muted-foreground" /></div>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Implement `NewProjectDialog.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/main";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function NewProjectDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const create = useMutation({
    mutationFn: () => api.createProject(id),
    onSuccess: () => {
      setId(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> New project</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>Give the project a unique id. CI pushes results to it.</DialogDescription>
        </DialogHeader>
        <form id="new-project" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-2">
          <Label htmlFor="np-id">Project id</Label>
          <Input id="np-id" autoFocus value={id} onChange={(e) => setId(e.target.value)} placeholder="my-service" />
        </form>
        <DialogFooter>
          <Button type="submit" form="new-project" disabled={!id || create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Sparkline.tsx packages/web/src/components/EmptyState.tsx packages/web/src/components/NewProjectDialog.tsx
git commit -m "feat(web): Sparkline, EmptyState, NewProjectDialog"
```

---

### Task 2.2: ProjectCard

**Files:**
- Create: `packages/web/src/components/ProjectCard.tsx`

Note on data: `api.listProjects` returns items with at least `{ id, latestRunId }` (see `Projects.tsx`). Use only fields known to exist; show the donut/sparkline only when run stats are present, otherwise a "no runs yet" state. If the list item lacks stats, the card links through without a donut — do **not** invent fields.

- [ ] **Step 1: Inspect the project list item shape**

Run: `pnpm --filter @allure-station/web exec tsc --noEmit` is not enough — read the type:
```bash
grep -rn "listProjects" packages/web/src/api/client.ts
```
Use the returned item type. The card props below accept an optional `stats` and `latestRunAt`; pass only what the API provides.

- [ ] **Step 2: Implement `ProjectCard.tsx`**

```tsx
import { Link } from "react-router-dom";
import { FolderOpen } from "lucide-react";
import { PassRateDonut } from "@/components/PassRateDonut";
import { passRate, relativeTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface ProjectCardData {
  id: string;
  latestRunId?: string | null;
  latestRunAt?: string | null;
  stats?: { passed: number; total: number } | null;
  visibility?: "public" | "private";
}

export function ProjectCard({ p }: { p: ProjectCardData }) {
  const hasRuns = !!p.latestRunId;
  const pct = p.stats ? passRate(p.stats) : null;
  return (
    <Link to={`/projects/${p.id}`} className="group block">
      <Card className="transition-shadow hover:shadow-md hover:border-primary/30">
        <CardContent className="flex items-center gap-4 p-5">
          {pct !== null ? (
            <PassRateDonut pct={pct} size={64} />
          ) : (
            <div className="grid size-16 place-items-center rounded-full bg-muted"><FolderOpen className="size-6 text-muted-foreground" /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold group-hover:text-primary">{p.id}</span>
              {p.visibility === "private" && <Badge variant="secondary" className="text-xs">private</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {hasRuns
                ? <>{p.stats ? `${p.stats.passed}/${p.stats.total} passed` : "has runs"}{p.latestRunAt ? ` · ${relativeTime(p.latestRunAt)}` : ""}</>
                : "No runs yet"}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/ProjectCard.tsx
git commit -m "feat(web): ProjectCard with donut + metadata"
```

---

### Task 2.3: Rebuild the Projects page

**Files:**
- Modify: `packages/web/src/pages/Projects.tsx`

- [ ] **Step 1: Rewrite `Projects.tsx`**

```tsx
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, FolderOpen } from "lucide-react";
import { api } from "../main.js";
import { Topbar } from "@/components/Topbar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { EmptyState } from "@/components/EmptyState";

const PAGE_SIZE = 20;

export function Projects() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const onSearch = (v: string) => { setQ(v); setPage(0); };

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, page],
    queryFn: () => api.listProjects({ q, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const items = (data?.items ?? []) as ProjectCardData[];
  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <>
      <Topbar title="Projects" actions={<NewProjectDialog />} />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search projects" placeholder="Search projects…" className="pl-9"
              value={q} onChange={(e) => onSearch(e.target.value)} />
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={FolderOpen}
              title={q ? `No projects matching “${q}”` : "No projects yet"}
              description={q ? "Try a different search." : "Create a project, then push results from CI."}
              action={!q ? <NewProjectDialog /> : undefined} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((p) => <ProjectCard key={p.id} p={p} />)}
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
              <span className="text-sm text-muted-foreground">Page {page + 1} of {maxPage + 1} · {total} total</span>
              <Button variant="outline" size="sm" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>Next →</Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Projects.tsx
git commit -m "feat(web): redesign Projects as a card-grid dashboard"
```

---

# Slice 3 — Project Workspace

### Task 3.1: RunSelector + UploadDialog

**Files:**
- Create: `packages/web/src/components/RunSelector.tsx`
- Create: `packages/web/src/components/UploadDialog.tsx`

- [ ] **Step 1: Implement `RunSelector.tsx`** (reuses the existing `runLabel` logic; keep it identical)

```tsx
import type { Run } from "@allure-station/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function runLabel(r: Run): string {
  const base = `${r.createdAt} — ${r.status}${r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}`;
  const meta = [
    r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : null,
    r.environment || null,
  ].filter(Boolean).join(" · ");
  return meta ? `${base} — ${meta}` : base;
}

const DOT: Record<string, string> = { ready: "bg-status-pass", failed: "bg-status-fail", generating: "bg-status-broken animate-pulse", pending: "bg-status-skip" };

export function RunSelector({ runs, value, onChange }: { runs: Run[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Select run to view" className="w-[320px] max-w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {runs.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            <span className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${DOT[r.status] ?? "bg-status-skip"}`} />
              <span className="truncate">{runLabel(r)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Implement `UploadDialog.tsx`**

```tsx
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/main";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function UploadDialog({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const files = Array.from(fileInput.current?.files ?? []);
      if (!files.length) throw new Error("Choose at least one result file");
      await api.sendResults(projectId, files);
      await api.generate(projectId);
    },
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["runs", projectId] });
      qc.invalidateQueries({ queryKey: ["trends", projectId] });
      toast.success("Generating report…");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Upload className="size-4" /> Upload &amp; generate</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload results</DialogTitle>
          <DialogDescription>Select Allure result files to generate a new run.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Allure result files" type="file" multiple ref={fileInput} />
        <DialogFooter>
          <Button disabled={upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Uploading…" : "Upload & generate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/RunSelector.tsx packages/web/src/components/UploadDialog.tsx
git commit -m "feat(web): RunSelector + UploadDialog"
```

---

### Task 3.2: Rebuild the Project page (keep all SSE/query logic)

**Files:**
- Modify: `packages/web/src/pages/Project.tsx`

This task restyles the page **without changing data logic**. Keep the `STATUS_RANK` constant, the three `useQuery` hooks, the SSE `useEffect`, the `branches`/`visibleRuns`/`current`/`cur` derivation, and the `projectDenied` guard **byte-for-byte**. Only the returned JSX and the helper components (`TrendBar`, `ComparePanel`, `Bucket`) change. Move `MembersPanel`, `AuditPanel`, `VisibilityControl`, and `runLabel` **out** of this file (they go to Slice 4 / RunSelector).

- [ ] **Step 1: Replace the `Project()` return JSX**

Within `Project()`, after the unchanged logic and the `projectDenied` early-return (restyled below), use:
```tsx
  if (projectDenied) {
    return (
      <>
        <Topbar title="Project unavailable" />
        <main className="grid flex-1 place-items-center p-6">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-semibold">Project unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This project is private or doesn’t exist. If it’s private, <Link to="/login" className="text-primary underline">sign in</Link> with an account that has access.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={<span className="flex items-center gap-2"><Link to="/" className="text-muted-foreground hover:text-foreground">Projects</Link><span className="text-muted-foreground">/</span><span className="truncate">{id}</span></span>}
        actions={<>
          {branches.length > 0 && (
            <Select value={branchFilter || "__all"} onValueChange={(v) => { setBranchFilter(v === "__all" ? "" : v); setSelectedRun(null); }}>
              <SelectTrigger aria-label="Filter by branch" className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">all branches</SelectItem>
                {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {current && <RunSelector runs={visibleRuns} value={current} onChange={setSelectedRun} />}
          <UploadDialog projectId={id} />
          {user && <Button variant="outline" size="icon" asChild aria-label="Project settings"><Link to={`/projects/${id}/settings`}><Settings className="size-4" /></Link></Button>}
        </>}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {cur && (cur.branch || cur.environment || cur.ciUrl) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {cur.branch && <Badge variant="secondary">branch {cur.branch}{cur.commit ? `@${cur.commit.slice(0, 7)}` : ""}</Badge>}
            {cur.environment && <Badge variant="secondary">env {cur.environment}</Badge>}
            {cur.ciUrl && <a href={cur.ciUrl} target="_blank" rel="noreferrer" className="text-primary underline">CI build ↗</a>}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Card className="flex-1 min-w-[260px]"><CardContent className="p-4"><TrendBar points={trends} /></CardContent></Card>
          <ComparePanel projectId={id} readyRuns={runs.filter((r) => r.status === "ready")} />
        </div>
        {current
          ? <iframe title="report" className="min-h-0 flex-1 rounded-lg border bg-card"
              src={`/api/projects/${id}/runs/${current}/report/index.html`} />
          : <EmptyState icon={FileBarChart} title="No ready report yet" description="Upload results to generate one." action={<UploadDialog projectId={id} />} />}
      </div>
    </>
  );
```

- [ ] **Step 2: Update imports at the top of `Project.tsx`**

Ensure these imports exist (add what's missing; keep the existing react-query / react-router / shared / api / auth imports):
```tsx
import { Settings, FileBarChart } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { RunSelector } from "@/components/RunSelector";
import { UploadDialog } from "@/components/UploadDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```
Remove the now-unused `useRef`/`fileInput` upload wiring and the old `runLabel` (now in `RunSelector`). Keep `useAuth` (`user` is used for the settings button).

- [ ] **Step 3: Restyle `TrendBar`, `ComparePanel`, `Bucket`**

Replace the three helper components at the bottom of the file:
```tsx
function TrendBar({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <span className="text-xs text-muted-foreground">Trends appear after 2+ runs.</span>;
  const w = points.length * 14;
  const anyFlaky = points.some((p) => (p.stats.flaky ?? 0) > 0);
  const maxDur = Math.max(1, ...points.map((p) => p.stats.durationMs ?? 0));
  const anyDur = points.some((p) => (p.stats.durationMs ?? 0) > 0);
  const durLine = points.map((p, i) => `${i * 14 + 5},${42 - Math.round(((p.stats.durationMs ?? 0) / maxDur) * 36) - 2}`).join(" ");
  return (
    <div className="flex items-end gap-3">
      <svg width={w} height={44} role="img" aria-label="pass-rate, flakiness and duration trend by run">
        {points.map((p, i) => {
          const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
          const h = Math.round(rate * 38) + 2;
          const flaky = p.stats.flaky ?? 0;
          const durMs = p.stats.durationMs ?? 0;
          return (
            <g key={p.runId}>
              <rect x={i * 14} y={42 - h} width={10} height={h} fill={p.stats.failed || p.stats.broken ? "#EF4444" : "#22C55E"}>
                <title>{`${new Date(p.createdAt).toLocaleString()}\n${p.stats.passed}/${p.stats.total} passed, ${p.stats.failed} failed, ${p.stats.broken} broken${flaky ? `, ${flaky} flaky` : ""}${durMs ? `\n${(durMs / 1000).toFixed(1)}s total` : ""}`}</title>
              </rect>
              {flaky > 0 && <rect x={i * 14} y={Math.max(0, 42 - h - 3)} width={10} height={3} fill="#F59E0B" pointerEvents="none" />}
            </g>
          );
        })}
        {anyDur && <polyline points={durLine} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} opacity={0.8} pointerEvents="none" />}
      </svg>
      <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Trend</span>
        {anyFlaky && <span className="text-status-broken">▮ flaky</span>}
        {anyDur && <span className="text-primary">╱ duration</span>}
      </div>
    </div>
  );
}

function ComparePanel({ projectId, readyRuns }: { projectId: string; readyRuns: Run[] }) {
  const [base, setBase] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const [touched, setTouched] = useState(false);
  useEffect(() => { setTouched(false); }, [projectId]);
  const readyIds = readyRuns.map((r) => r.id).join(",");
  useEffect(() => {
    const ids = readyIds ? readyIds.split(",") : [];
    if (touched) {
      setTarget((t) => (ids.includes(t) ? t : ids[0] ?? ""));
      setBase((b) => (ids.includes(b) ? b : ids[1] ?? ""));
    } else { setTarget(ids[0] ?? ""); setBase(ids[1] ?? ""); }
  }, [readyIds, touched]);
  const { data: diff } = useQuery({
    queryKey: ["compare", projectId, base, target],
    queryFn: () => api.compareRuns(projectId, base, target),
    enabled: !!base && !!target && base !== target,
  });
  if (readyRuns.length < 2) return null;
  const pick = (set: (v: string) => void) => (v: string) => { setTouched(true); set(v); };
  const runItems = readyRuns.map((r) => (
    <SelectItem key={r.id} value={r.id}>{r.createdAt}{r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}</SelectItem>
  ));
  return (
    <Card className="flex-1 min-w-[300px]">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Compare</span>
          <Select value={base} onValueChange={pick(setBase)}><SelectTrigger className="h-8 w-[180px]" aria-label="Base run"><SelectValue /></SelectTrigger><SelectContent>{runItems}</SelectContent></Select>
          <span className="text-muted-foreground">→</span>
          <Select value={target} onValueChange={pick(setTarget)}><SelectTrigger className="h-8 w-[180px]" aria-label="Target run"><SelectValue /></SelectTrigger><SelectContent>{runItems}</SelectContent></Select>
        </div>
        {base === target ? <p className="text-sm text-muted-foreground">Pick two different runs.</p>
          : !diff ? <p className="text-sm text-muted-foreground">Loading comparison…</p>
          : (
            <div className="flex flex-wrap gap-4">
              <Bucket label="Newly failing" color="text-status-fail" tests={diff.newlyFailing} />
              <Bucket label="Fixed" color="text-status-pass" tests={diff.fixed} />
              <Bucket label="Flaky" color="text-status-broken" tests={diff.flaky} />
              <Bucket label="Still failing" color="text-status-fail" tests={diff.stillFailing} />
              <Bucket label="Added" color="text-primary" tests={diff.added} />
              <Bucket label="Removed" color="text-muted-foreground" tests={diff.removed} />
            </div>
          )}
      </CardContent>
    </Card>
  );
}

function Bucket({ label, color, tests }: { label: string; color: string; tests: TestDiff[] }) {
  if (tests.length === 0) return null;
  return (
    <div className="min-w-[180px]">
      <div className={`text-sm font-semibold ${color}`}>{label} ({tests.length})</div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {tests.map((t) => (
          <li key={(t.historyId ?? t.fullName ?? t.name) + label}>
            {t.name}
            {t.baseStatus && t.targetStatus ? <span className="text-muted-foreground"> ({t.baseStatus}→{t.targetStatus})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/Project.tsx
git commit -m "feat(web): redesign Project workspace (logic unchanged)"
```

---

# Slice 4 — Project Settings Page

### Task 4.1: Build the settings page from the lifted panels

**Files:**
- Modify: `packages/web/src/pages/ProjectSettings.tsx` (replace placeholder)

This page moves `MembersPanel`, `VisibilityControl`, and `AuditPanel` out of `Project.tsx`. The **queries, mutations, and gating logic stay identical** to the originals (see `Project.tsx` git history / the spec). Only presentation changes.

- [ ] **Step 1: Implement `ProjectSettings.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { ProjectRole } from "@allure-station/shared";
import { toast } from "sonner";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROJECT_ROLES: ProjectRole[] = ["viewer", "maintainer", "owner"];

export function ProjectSettings() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  // Owner-gated members fetch doubles as the capability probe (mirrors the old inline panels).
  const { data: members, isError } = useQuery({
    queryKey: ["members", id], queryFn: () => api.listMembers(id), enabled: !!user, retry: false,
  });
  const denied = !user || isError;
  return (
    <>
      <Topbar title={<span className="flex items-center gap-2"><Link to={`/projects/${id}`} className="text-muted-foreground hover:text-foreground">{id}</Link><span className="text-muted-foreground">/</span>Settings</span>} />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {denied ? (
            <p className="text-sm text-muted-foreground">You don’t have access to this project’s settings.</p>
          ) : (
            <>
              <VisibilityCard projectId={id} />
              <MembersCard projectId={id} members={members ?? []} />
              <AuditCard projectId={id} />
            </>
          )}
        </div>
      </main>
    </>
  );
}

function VisibilityCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.getProject(projectId) });
  const setVis = useMutation({
    mutationFn: (visibility: "public" | "private") => api.setVisibility(projectId, visibility),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", projectId] }); toast.success("Visibility updated"); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!project) return null;
  const next = project.visibility === "private" ? "public" : "private";
  return (
    <Card>
      <CardHeader><CardTitle>Visibility</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-3">
        <Badge variant={project.visibility === "private" ? "secondary" : "outline"}>{project.visibility}</Badge>
        <Button variant="outline" size="sm" disabled={setVis.isPending} onClick={() => setVis.mutate(next)}>Make {next}</Button>
        {project.visibility === "private" && <span className="text-sm text-muted-foreground">Reads require viewer+; the badge stays public.</span>}
      </CardContent>
    </Card>
  );
}

function MembersCard({ projectId, members }: { projectId: string; members: { userId: string; email: string; role: string }[] }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("viewer");
  const setMember = useMutation({
    mutationFn: () => api.setMember(projectId, email, role),
    onSuccess: () => { setEmail(""); qc.invalidateQueries({ queryKey: ["members", projectId] }); toast.success("Member saved"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeMember(projectId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", projectId] }),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Members ({members.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); setMember.mutate(); }} className="flex flex-wrap items-center gap-2">
          <Input aria-label="Member email" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="max-w-xs" />
          <Select value={role} onValueChange={(v) => setRole(v as ProjectRole)}>
            <SelectTrigger aria-label="Member role" className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="submit" disabled={setMember.isPending}>Add / update</Button>
        </form>
        <Table>
          <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>{m.email}</TableCell>
                <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => removeMember.mutate(m.userId)}>Remove</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AuditCard({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ["project-audit", projectId], queryFn: () => api.listProjectAudit(projectId, { limit: 50 }), retry: false,
  });
  if (data === undefined) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Audit ({data.total})</CardTitle></CardHeader>
      <CardContent>
        {data.items.length === 0 ? <p className="text-sm text-muted-foreground">No events yet.</p> : (
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {data.items.map((e) => (
              <li key={e.id}>
                <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span>{" "}
                <span className="font-medium">{e.action}</span> by {e.actorLabel}
                {e.metadata ? <span className="text-muted-foreground"> {JSON.stringify(e.metadata)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/ProjectSettings.tsx
git commit -m "feat(web): dedicated project settings page (members/visibility/audit)"
```

---

# Slice 5 — Login, Users, Audit

### Task 5.1: Redesign Login

**Files:**
- Modify: `packages/web/src/pages/Login.tsx`

Keep the existing logic (`useAuth`, `submit`, `config` query, error handling) unchanged. Replace only the returned JSX.

- [ ] **Step 1: Replace the `return (...)` of `Login()`**

```tsx
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-gradient-to-br from-[#1ED6B2] via-[#12B58F] to-[#0A916F] p-10 text-white lg:flex">
        <div className="flex items-center gap-2 font-semibold"><img src="/favicon.svg" alt="" className="size-8" /> Allure Station</div>
        <div><h2 className="text-2xl font-semibold">Your test reports, beautifully hosted.</h2><p className="mt-2 max-w-sm text-white/80">Multi-project Allure 3 reports with trends, run comparison, and access control.</p></div>
        <span className="text-sm text-white/60">Self-hosted report hub</span>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center lg:hidden"><img src="/favicon.svg" alt="Allure Station" className="mx-auto size-12" /></div>
          <div><h1 className="text-xl font-semibold">Sign in to Allure Station</h1><p className="mt-1 text-sm text-muted-foreground">Use SSO or your email and password.</p></div>
          {config?.oidc.enabled && (
            <>
              <Button asChild variant="outline" className="w-full"><a href="/api/auth/oidc/login">Sign in with {config.oidc.label ?? "SSO"}</a></Button>
              <div className="relative text-center text-xs text-muted-foreground"><span className="bg-background px-2">or</span><div className="absolute inset-x-0 top-1/2 -z-10 border-t" /></div>
            </>
          )}
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 2: Update Login imports**

Add:
```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Login.tsx
git commit -m "feat(web): redesign Login with brand split-panel"
```

---

### Task 5.2: Redesign Users (admin)

**Files:**
- Modify: `packages/web/src/pages/Users.tsx`

- [ ] **Step 1: Read the current Users page logic**

```bash
cat packages/web/src/pages/Users.tsx
```
Preserve every query/mutation and admin gate. Replace only the presentation: wrap in `<Topbar title="Users" />` + `<main className="flex-1 overflow-auto p-6"><div className="mx-auto max-w-4xl space-y-6">…</div></main>`, render the list as a shadcn `Table`, inputs as `Input`/`Select`, buttons as `Button`, and route mutation errors through `toast.error`.

- [ ] **Step 2: Apply the redesign**

Mirror the structure of `MembersCard` (Task 4.1) for the table + add-user form. Use the same imports (`Topbar`, `Table*`, `Input`, `Button`, `Select*`, `Badge`, `toast`). Keep field names and handlers identical to the original file.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Users.tsx
git commit -m "feat(web): redesign Users admin table"
```

---

### Task 5.3: Redesign Audit (admin)

**Files:**
- Modify: `packages/web/src/pages/Audit.tsx`

- [ ] **Step 1: Read the current Audit page logic**

```bash
cat packages/web/src/pages/Audit.tsx
```
Preserve the query/pagination/filter logic. Replace presentation only.

- [ ] **Step 2: Apply the redesign**

Wrap in `<Topbar title="Audit" />` + the same `<main>` container. Render events as a timeline/list (mirror `AuditCard` in Task 4.1) or a `Table` with columns `When / Action / Actor / Details`. Keep any existing filters as `Input`/`Select`. Use `relativeTime` from `@/lib/format` for the timestamps where a compact form helps; keep `toLocaleString` in a tooltip/title if desired.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @allure-station/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Audit.tsx
git commit -m "feat(web): redesign Audit admin view"
```

---

# Slice 6 — Polish & Screenshot QA

### Task 6.1: Full-app verification

**Files:** none (verification + fixes only)

- [ ] **Step 1: Typecheck, test, build**

Run:
```bash
pnpm --filter @allure-station/web typecheck
pnpm --filter @allure-station/web test
pnpm --filter @allure-station/web build
```
Expected: all PASS. Fix any failures before continuing.

- [ ] **Step 2: Boot the stack for visual QA**

Run the server + web dev per CLAUDE.md (`pnpm --filter @allure-station/server dev` and `pnpm --filter @allure-station/web dev`), or the full app. Seed at least 2 projects with runs (use existing `demo` / `kotest-examples` data) so donuts, trends, and compare render.

- [ ] **Step 3: Screenshot every surface in light + dark via Playwright MCP**

For each route — `/` (Projects), `/projects/:id` (Project), `/projects/:id/settings`, `/login`, `/users`, `/audit` — navigate, toggle theme via the user menu, and capture a screenshot. Check against the spec:
  - sidebar nav + active state correct; admin links gated
  - Projects grid: donuts, sparklines, empty state, New-project dialog
  - Project: run selector dots, summary, trend card, compare card, framed iframe
  - settings: cards render; non-owner sees the access message
  - login split-panel; users/audit tables
  - dark mode: no unstyled white flashes, AA contrast on text/badges
  - responsive: shrink to mobile width → sidebar becomes the sheet, grids/​toolbars reflow

- [ ] **Step 4: Fix visual defects found, re-screenshot**

Apply targeted CSS/class fixes for any issues. Re-capture the affected route. Commit fixes:
```bash
git add -A packages/web
git commit -m "fix(web): visual QA polish across surfaces"
```

- [ ] **Step 5: Final commit / branch ready**

Confirm the working tree is clean and the branch `ui-redesign` builds. Ready for PR.

---

## Self-Review Notes

- **Spec coverage:** design system (0.1–0.4), palette/dark mode (0.3), shell sidebar+topbar (1.3–1.4), Projects dashboard (2.x), Project workspace incl. iframe untouched + SSE preserved (3.x), dedicated settings page (4.1), Login/Users/Audit (5.x), toasts/skeletons/empty states/responsive/a11y/screenshots (cross-cutting + 6.1). All mapped.
- **Behavior preservation:** Tasks 3.2, 4.1, 5.1–5.3 explicitly keep queries/mutations/SSE/RBAC logic identical; only JSX changes.
- **No invented fields:** Task 2.2 Step 1 forces reading the real `listProjects` item type before using `stats`/`latestRunAt`; the card degrades gracefully when absent.
- **Type consistency:** `runLabel` lives only in `RunSelector` after Slice 3; `donutDash`/`passRate`/`relativeTime` signatures match their tests; `cn`/`@/` alias defined in 0.2 before first use.
