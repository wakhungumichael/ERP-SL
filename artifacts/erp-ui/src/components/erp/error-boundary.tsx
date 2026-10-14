import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toUserFriendlyError } from '@/lib/api-errors';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Keeps a rendering error contained to the workspace instead of exposing a blank page. */
export class ERPErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ERP workspace rendering error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <section className="w-full max-w-xl rounded-xl border bg-background p-7 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-600" />
          <h1 className="mt-4 text-xl font-semibold">This workspace needs to reload</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {toUserFriendlyError(this.state.error, 'An unexpected problem occurred while opening this workspace.')}
          </p>
          <Button className="mt-5" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reload workspace
          </Button>
        </section>
      </main>
    );
  }
}
