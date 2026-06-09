import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies `value` to the clipboard and toasts. Shared by the token-reveal and badge-snippet cards. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  return (
    <Button size="sm" variant="outline" className={className}
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast.success("Copied")); }}>
      {label}
    </Button>
  );
}
