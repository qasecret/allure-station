import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/main";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const META_KEYS = ["branch", "commit", "environment", "ciUrl"] as const;
type Meta = Record<(typeof META_KEYS)[number], string>;
const emptyMeta: Meta = { branch: "", commit: "", environment: "", ciUrl: "" };
// Only branch and environment are stable across uploads; commit and ciUrl are inherently
// per-upload and must not be silently re-attached to a new run.
const PERSISTED_KEYS = ["branch", "environment"] as const;
const storageKey = (projectId: string) => `upload-meta:${projectId}`;
const loadMeta = (projectId: string): Meta => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "{}") as Record<string, unknown>;
    // Only restore the persisted subset; commit and ciUrl always start blank.
    return Object.fromEntries(
      META_KEYS.map((k) => [k, PERSISTED_KEYS.includes(k as (typeof PERSISTED_KEYS)[number]) && typeof parsed[k] === "string" ? parsed[k] : ""])
    ) as Meta;
  } catch { return emptyMeta; }
};

export function UploadDialog({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState<Meta>(() => loadMeta(projectId));

  useEffect(() => setMeta(loadMeta(projectId)), [projectId]);

  const upload = useMutation({
    mutationFn: async () => {
      const files = Array.from(fileInput.current?.files ?? []);
      if (!files.length) throw new Error("Choose at least one result file");
      await api.sendResults(projectId, files, meta);
      await api.generate(projectId);
    },
    onSuccess: () => {
      try {
        const persisted = Object.fromEntries(PERSISTED_KEYS.map((k) => [k, meta[k]]));
        localStorage.setItem(storageKey(projectId), JSON.stringify(persisted));
      } catch { /* private mode / storage full */ }
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
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Add CI context (optional)</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {META_KEYS.map((k) => (
              <div key={k} className="flex flex-col gap-1">
                <Label htmlFor={`upload-${k}`} className="text-xs text-muted-foreground">{k === "ciUrl" ? "CI build URL" : k[0].toUpperCase() + k.slice(1)}</Label>
                <Input id={`upload-${k}`} value={meta[k]} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))}
                  placeholder={k === "branch" ? "main" : k === "commit" ? "a1b2c3d" : k === "environment" ? "staging" : "https://ci.example.com/build/42"} />
              </div>
            ))}
          </div>
        </details>
        <DialogFooter>
          <Button disabled={upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Uploading…" : "Upload & generate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
