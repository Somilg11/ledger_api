import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = { children: ReactNode; scope?: string; fullPage?: boolean };
/** Render failures stay local; raw errors and credentials never reach the fallback UI. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // A production error reporter can be added here with explicit redaction.
    // Do not send account data, browser storage, URLs, or raw exception payloads.
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className={`bg-background flex min-h-[260px] items-center justify-center p-6 ${this.props.fullPage ? 'h-dvh overflow-y-auto' : 'h-full rounded-xl border'}`}
      >
        <div className="max-w-sm space-y-4 text-center">
          <AlertTriangle className="text-primary mx-auto size-7" />
          <h1 className="text-lg font-semibold">{this.props.scope ?? 'This view'} could not load</h1>
          <p className="text-muted-foreground text-sm">
            Your account data stays on the server. If a payment was in progress, check Transactions before
            starting another payment.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => this.setState({ failed: false })}>
              <RotateCcw className="size-3.5" />
              Try again
            </Button>
            <Button onClick={() => window.location.reload()}>Reload app</Button>
          </div>
          <a href="/transactions" className="text-muted-foreground block text-xs underline">
            Open Transactions
          </a>
        </div>
      </div>
    );
  }
}
