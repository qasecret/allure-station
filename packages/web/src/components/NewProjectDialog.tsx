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
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.createProject(id, name.trim() || undefined),
    onSuccess: () => {
      setId(""); setName(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setId(""); setName(""); } }}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> New project</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>Give the project a unique id. CI pushes results to it.</DialogDescription>
        </DialogHeader>
        <form id="new-project" onSubmit={(e) => { e.preventDefault(); if (!id || create.isPending) return; create.mutate(); }} className="space-y-2">
          <Label htmlFor="np-id">Project id</Label>
          <Input id="np-id" autoFocus value={id} onChange={(e) => setId(e.target.value)} placeholder="my-service" />
          <Label htmlFor="np-name">Display name <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Demo Web App" />
        </form>
        <DialogFooter>
          <Button type="submit" form="new-project" disabled={!id || create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
