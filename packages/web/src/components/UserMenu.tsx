import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { LogOut, Monitor, Sun, Moon, ChevronsUpDown, Settings } from "lucide-react";
import { toast } from "sonner";
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
  const [theme, setThemeState] = useState<Theme>(getTheme());
  useEffect(() => {
    const handler = () => setThemeState(getTheme());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  const chooseTheme = (t: Theme) => { setThemeState(t); setTheme(t); };

  const themeRow = (
    <div className="flex gap-1 px-2 py-1.5" role="group" aria-label="Color theme">
      {THEMES.map(({ key, label, icon: Icon }) => (
        <Button key={key} variant={theme === key ? "secondary" : "ghost"} size="sm"
          className="flex-1 h-7" aria-label={label} title={label}
          aria-pressed={theme === key}
          onClick={() => chooseTheme(key)}>
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

  const initials = user.email.split("@")[0].slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2 px-2 h-auto py-2">
          {/* Solid primary + primary-foreground (AA 7:1 per MASTER.md tokens): the tinted
              bg-primary/10 + text-primary combo failed the axe color-contrast gate (authed.spec.ts). */}
          <Avatar className="size-7"><AvatarFallback className="text-xs bg-primary text-primary-foreground">{initials}</AvatarFallback></Avatar>
          <span className="flex-1 truncate text-left text-sm">{user.email}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themeRow}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account"><Settings className="size-4" /> Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={async () => {
          try { await logout(); navigate("/"); }
          catch { toast.error("Sign out failed. Please try again."); }
        }}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
