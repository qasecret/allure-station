import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GlobalRole } from "@allure-station/shared";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function Users() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<GlobalRole>("user");
  const [error, setError] = useState<string | null>(null);

  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers(), enabled: user?.role === "admin" });
  const create = useMutation({
    mutationFn: () => api.createUser(email, password, role),
    onSuccess: () => { setEmail(""); setPassword(""); setError(null); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e: Error) => setError(e.message.includes("409") ? "Email already in use." : "Could not create user (password must be 8+ chars)."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  if (isLoading) return null;
  if (user?.role !== "admin") return (<><Topbar title="Users" /><main className="grid flex-1 place-items-center p-6"><p className="text-sm text-muted-foreground">Admins only.</p></main></>);

  return (
    <>
      <Topbar title="Users" />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <Card>
            <CardContent className="p-4">
              <form onSubmit={(e) => { e.preventDefault(); if (create.isPending) return; create.mutate(); }} className="flex flex-wrap items-end gap-2">
                <Input aria-label="New user email" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="max-w-[220px]" />
                <Input aria-label="New user password" type="password" placeholder="password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} required className="max-w-[200px]" />
                <Select value={role} onValueChange={(v) => setRole(v as GlobalRole)}>
                  <SelectTrigger aria-label="New user role" className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="user">user</SelectItem><SelectItem value="admin">admin</SelectItem></SelectContent>
                </Select>
                <Button type="submit" disabled={create.isPending}>Add user</Button>
              </form>
              {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              {/* Mobile list — visible below sm */}
              <ul role="list" className="divide-y sm:hidden">
                {users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 p-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{u.email}</span>
                      <Badge variant="secondary" className="mt-0.5">{u.role}</Badge>
                    </span>
                    {u.id !== user.id && <Button variant="ghost" size="sm" disabled={remove.isPending && remove.variables === u.id} onClick={() => remove.mutate(u.id)}>Remove</Button>}
                  </li>
                ))}
              </ul>
              {/* Desktop table — hidden below sm */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.email}</TableCell>
                        <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                        <TableCell className="text-right">{u.id !== user.id && <Button variant="ghost" size="sm" disabled={remove.isPending && remove.variables === u.id} onClick={() => remove.mutate(u.id)}>Remove</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
