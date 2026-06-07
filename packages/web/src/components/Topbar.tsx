import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/Sidebar";

export function Topbar({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b bg-background/80 px-6 py-3 backdrop-blur">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="-ml-2 md:hidden" aria-label="Open menu"><Menu className="size-5" /></Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </header>
  );
}
