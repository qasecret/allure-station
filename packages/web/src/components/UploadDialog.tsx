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
