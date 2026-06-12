import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GlobalRole } from "@allure-station/shared";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { SortTh } from "@/components/SortTh";
import { Topbar } from "@/components/Topbar";
import { QueryErrorState } from "@/components/QueryErrorState";
import { humanizeError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type UserSortKey = "email" | "role";
type SortOrder = "asc" | "desc";

function nextSort(current: UserSortKey | null, order: SortOrder | null, key: UserSortKey): { sortKey: UserSortKey | null; order: SortOrder | null } {
  if (current !== key) return { sortKey: key, order: "asc" };
  if (order === "asc") return { sortKey: key, order: "desc" };
  return { sortKey: null, order: null };
}

export function Users() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<GlobalRole>("user");
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<UserSortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder | null>(null);

  const { data: rawUsers = [], isError: usersError, error: usersErrorVal, refetch: refetchUsers } = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers(), enabled: user?.role === "admin" });

  const users = useMemo(() => {
    if (!sortKey) return rawUsers;
    return [...rawUsers].sort((a, b) => {
      const av = sortKey === "email" ? a.email : a.role;
      const bv = sortKey === "email" ? b.email : b.role;
      const cmp = av.localeCompare(bv);
      return sortOrder === "desc" ? -cmp : cmp;
    });
  }, [rawUsers, sortKey, sortOrder]);

  const handleSort = (key: UserSortKey) => {
    const next = nextSort(sortKey, sortOrder, key);
    setSortKey(next.sortKey);
    setSortOrder(next.order);
  };

  const create = useMutation({
    mutationFn: () => api.createUser(email, password, role),
    onSuccess: () => { setEmail(""); setPassword(""); setError(null); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e) => setError(humanizeError(e, "user")),
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
          {usersError && <QueryErrorState error={usersErrorVal} onRetry={() => refetchUsers()} />}
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
                  <TableHeader>
                    <TableRow>
                      <SortTh label="Email" sortKey="email" activeSortKey={sortKey} sortOrder={sortOrder} onSort={() => handleSort("email")} as={TableHead} />
                      <SortTh label="Role" sortKey="role" activeSortKey={sortKey} sortOrder={sortOrder} onSort={() => handleSort("role")} as={TableHead} />
                      <TableHead />
                    </TableRow>
                  </TableHeader>
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
