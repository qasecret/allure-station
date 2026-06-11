import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/Sidebar";

export function Topbar({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/80 px-4 py-3 backdrop-blur md:flex-nowrap md:px-6">
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
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto md:flex-nowrap md:shrink-0">{actions}</div>
    </header>
  );
}
