import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginInput, RegisterInput, SessionDto, UserDto, WorkspaceDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';

interface SessionContextValue {
  user: UserDto | null;
  workspaces: WorkspaceDto[];
  workspace: WorkspaceDto | null;
  isLoading: boolean;
  switchWorkspace: (workspaceId: string) => void;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

type SessionResponse = SessionDto | { user: null; workspaces: []; activeWorkspaceId: null };

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [preferredWorkspaceId, setPreferredWorkspaceId] = useLocalStorage<string | null>(
    'flowdesk.workspace',
    null,
  );

  const { data, isLoading } = useQuery({
    queryKey: qk.session,
    queryFn: () => api.get<SessionResponse>('/auth/session'),
    // The session is the app's root dependency — never garbage collect it.
    staleTime: 60_000,
    gcTime: Infinity,
    retry: false,
  });

  const user = data?.user ?? null;
  const workspaces = useMemo(() => data?.workspaces ?? [], [data]);

  const workspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    return workspaces.find((w) => w.id === preferredWorkspaceId) ?? workspaces[0]!;
  }, [workspaces, preferredWorkspaceId]);

  const loginMutation = useMutation({
    mutationFn: (input: LoginInput) => api.post<SessionDto>('/auth/login', input),
    onSuccess: (session) => {
      queryClient.setQueryData(qk.session, session);
      setPreferredWorkspaceId(session.activeWorkspaceId);
    },
  });

  const registerMutation = useMutation({
    mutationFn: (input: RegisterInput) => api.post<SessionDto>('/auth/register', input),
    onSuccess: (session) => {
      queryClient.setQueryData(qk.session, session);
      setPreferredWorkspaceId(session.activeWorkspaceId);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSuccess: () => {
      // Clearing the whole cache prevents one account seeing another's data.
      queryClient.clear();
      queryClient.setQueryData(qk.session, { user: null, workspaces: [], activeWorkspaceId: null });
    },
  });

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      workspaces,
      workspace,
      isLoading,
      switchWorkspace: (id: string) => setPreferredWorkspaceId(id),
      login: async (input) => void (await loginMutation.mutateAsync(input)),
      register: async (input) => void (await registerMutation.mutateAsync(input)),
      logout: async () => void (await logoutMutation.mutateAsync()),
      refresh: async () => void (await queryClient.invalidateQueries({ queryKey: qk.session })),
    }),
    [user, workspaces, workspace, isLoading, setPreferredWorkspaceId, loginMutation, registerMutation, logoutMutation, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

/** Convenience for screens that are only reachable when signed in. */
export function useCurrentUser(): UserDto {
  const { user } = useSession();
  if (!user) throw new Error('useCurrentUser called outside an authenticated route');
  return user;
}

export function useWorkspace(): WorkspaceDto {
  const { workspace } = useSession();
  if (!workspace) throw new Error('useWorkspace called without an active workspace');
  return workspace;
}


