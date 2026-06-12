import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Rendered when the React tree below the boundary throws — the app must never blank. */
export function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto size-8 text-status-broken-text" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">The page hit an unexpected error. Reloading usually fixes it.</p>
        <details className="mt-3 text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="mt-1 overflow-auto whitespace-pre-wrap">{error.message}</pre>
        </details>
        <Button className="mt-4" onClick={() => location.reload()}>Reload</Button>
      </div>
    </div>
  );
}

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary:", error, info.componentStack);
  }
  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} />;
    return this.props.children;
  }
}
