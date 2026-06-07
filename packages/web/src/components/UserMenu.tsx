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
