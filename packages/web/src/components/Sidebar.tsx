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
      <NavLink to="/" aria-label="Allure Station home" className="flex items-center gap-2 px-2 py-2 pr-10">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span className="font-semibold tracking-tight">Allure Station</span>
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
    <aside className="hidden w-60 shrink-0 border-r bg-card md:block">
      <SidebarContent />
    </aside>
  );
}
