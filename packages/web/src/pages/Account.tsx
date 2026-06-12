import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionInfo } from "@allure-station/shared";
import { toast } from "sonner";
import { LogIn } from "lucide-react";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { Topbar } from "@/components/Topbar";
import { QueryErrorState } from "@/components/QueryErrorState";
import { CardSkeleton, TableSkeleton } from "@/components/skeletons";
import { TimeStamp } from "@/components/TimeStamp";
import { humanizeError, ApiError } from "@/lib/errors";
import { describeUserAgent } from "@/lib/user-agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function ProfileCard() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground w-16">Email</span>
          <span className="text-sm font-medium">{user.email}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground w-16">Role</span>
          <Badge variant="secondary">{user.role}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Inline validation errors
  const nextTooShort = next.length > 0 && next.length < 8;
  const confirmMismatch = confirm.length > 0 && next !== confirm;

  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm;

  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setInlineError(null);
      toast.success("Password changed — other sessions were signed out.");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 400 && e.serverMessage.includes("invalid credentials")) {
        setInlineError("Current password is incorrect.");
      } else {
        setInlineError(humanizeError(e));
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || change.isPending) return;
            setInlineError(null);
            change.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              aria-describedby={nextTooShort ? "new-password-error" : undefined}
            />
            {nextTooShort && (
              <p id="new-password-error" role="alert" className="text-xs text-destructive">
                Password must be at least 8 characters.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              aria-describedby={confirmMismatch ? "confirm-password-error" : undefined}
            />
            {confirmMismatch && (
              <p id="confirm-password-error" role="alert" className="text-xs text-destructive">
                Passwords do not match.
              </p>
            )}
          </div>
          {inlineError && (
            <p role="alert" className="text-sm text-destructive">{inlineError}</p>
          )}
          <Button type="submit" disabled={!canSubmit || change.isPending}>
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { logout } = useAuth();

  const {
    data: sessions = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<SessionInfo[]>({
    queryKey: ["sessions"],
    queryFn: () => api.listSessions(),
  });

  const revoke = useMutation({
    mutationFn: (s: SessionInfo) => api.revokeSession(s.id),
    onSuccess: async (_data, s) => {
      if (s.current) {
        // Revoking the current session → server cleared the cookie → go to login
        await qc.invalidateQueries({ queryKey: ["me"] });
        navigate("/login");
      } else {
        qc.invalidateQueries({ queryKey: ["sessions"] });
      }
    },
    onError: (e) => toast.error(humanizeError(e)),
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      const n = data.revoked;
      toast.success(`Signed out ${n} other session${n === 1 ? "" : "s"}.`);
    },
    onError: (e) => toast.error(humanizeError(e)),
  });

  const otherCount = sessions.filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>Active sessions</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={otherCount === 0 || revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}
        >
          Sign out everywhere else
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isError && (
          <div className="p-4">
            <QueryErrorState error={error} onRetry={() => refetch()} />
          </div>
        )}
        {isLoading && (
          <div className="p-4">
            <TableSkeleton rows={3} cols={3} />
          </div>
        )}
        {!isLoading && !isError && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead className="hidden sm:table-cell">IP</TableHead>
                <TableHead>Started</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{describeUserAgent(s.userAgent)}</span>
                      {s.current && (
                        <Badge variant="secondary" className="text-xs">Current</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {s.ip ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <TimeStamp iso={s.createdAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={s.current ? "Sign out this session" : "Revoke session"}
                      disabled={revoke.isPending && revoke.variables?.id === s.id}
                      onClick={() => {
                        if (s.current) {
                          logout().catch(() => {});
                          navigate("/login");
                        } else {
                          revoke.mutate(s);
                        }
                      }}
                    >
                      {s.current ? "Sign out" : "Revoke"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function Account() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <>
        <Topbar title="Account" />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-2xl space-y-6">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Topbar title="Account" />
        <main className="grid flex-1 place-items-center p-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-muted-foreground">Sign in to manage your account.</p>
            <Button asChild variant="default">
              <Link to="/login"><LogIn className="size-4" /> Sign in</Link>
            </Button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar title="Account" />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <ProfileCard />
          <PasswordCard />
          <SessionsCard />
        </div>
      </main>
    </>
  );
}
