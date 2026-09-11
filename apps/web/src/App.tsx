import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { ThemeProvider } from './app/theme';
import { ToastProvider } from './app/toast';
import { SessionProvider } from './app/session';
import { RealtimeProvider } from './app/realtime';
import { AppRoutes } from './routes';
import { Button } from './ui/Button';

/**
 * Query defaults tuned for a collaborative tool: data is briefly fresh,
 * refetches on focus (someone else may have changed it) and never retries a
 * 4xx, which would just repeat a permission error.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

interface BoundaryState {
  error: Error | null;
}

/** Last line of defence — a render crash shows a recoverable screen, not a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
          <h1 className="text-xl font-semibold">Экран сломался</h1>
          <p className="max-w-md text-sm text-text-muted">
            Ошибка записана в консоль. Обычно помогает перезагрузка — данные в безопасности.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Перезагрузить
            </Button>
            <Button onClick={() => this.setState({ error: null })}>Повторить</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <BrowserRouter>
              <SessionProvider>
                <RealtimeProvider>
                  <AppRoutes />
                </RealtimeProvider>
              </SessionProvider>
            </BrowserRouter>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
