import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { qk } from './lib/queryKeys';
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

/**
 * A 401 on any query or mutation means the session is gone. Invalidating the
 * session query flips it to an error, and RequireAuth redirects to /login.
 * The failing session query itself is left alone so the redirect cannot loop.
 */
function useSessionExpiryRedirect() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleError = (queryKey: readonly unknown[], error: unknown) => {
      if (queryKey[0] === qk.session[0]) return;
      if (error instanceof ApiError && error.isAuth) {
        void queryClient.invalidateQueries({ queryKey: qk.session });
      }
    };

    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        handleError(event.query.queryKey, event.action.error);
      }
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        handleError([], event.action.error);
      }
    });

    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient]);
}

/**
 * Lives inside QueryClientProvider — the hook watches the caches for 401s and
 * forces the session query to refetch, which lets RequireAuth redirect.
 */
function SessionExpiryWatcher() {
  useSessionExpiryRedirect();
  return null;
}

/**
 * A data router, only so that a half-filled form can ask before the page is
 * left (`useBlocker`). The routes themselves stay declared in `AppRoutes`.
 */
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <SessionProvider>
        <RealtimeProvider>
          <AppRoutes />
        </RealtimeProvider>
      </SessionProvider>
    ),
  },
]);

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionExpiryWatcher />
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
