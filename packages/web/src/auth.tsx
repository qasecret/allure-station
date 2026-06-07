import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@allure-station/shared";
import { api } from "./main.js";

interface AuthState {
  user: SessionUser | null;
  isLoading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });

  const loginM = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
    // Refetch every query so public lists re-render with the new identity's write affordances.
    onSuccess: () => qc.invalidateQueries(),
  });
  const logoutM = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => qc.invalidateQueries(),
  });

  const value: AuthState = {
    user: data ?? null,
    isLoading,
    login: async (email, password) => { await loginM.mutateAsync({ email, password }); },
    logout: async () => { await logoutM.mutateAsync(); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
