import { NavLink } from "react-router-dom";
import { LayoutGrid, Users, ScrollText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";
import { api } from "../main.js";

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground");

export function SidebarContent() {
  const { user } = useAuth();
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: () => api.getConfig(), staleTime: Infinity });
  const brand = config?.branding;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <NavLink to="/" aria-label={`${brand?.name ?? "Allure Station"} home`} className="flex items-center gap-2 px-2 py-2 pr-10">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span className="font-semibold tracking-tight">{brand?.name ?? "Allure Station"}</span>
      </NavLink>
      <nav aria-label="Main" className="flex flex-col gap-1">
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
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
      <SidebarContent />
    </aside>
  );
}
