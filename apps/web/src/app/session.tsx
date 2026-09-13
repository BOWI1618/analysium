import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptInviteInput,
  JoinWithCodeInput,
  LoginInput,
  RegisterInput,
  SessionDto,
  UserDto,
  WorkspaceDto,
} from '@flowdesk/contracts';
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
  /** Resolves to `true` when a verification link was sent instead of a session. */
  register: (input: RegisterInput) => Promise<boolean>;
  /** Redeems a join code. Resolves to `true` when a verification link was sent instead of a session. */
  joinWithCode: (input: JoinWithCodeInput) => Promise<boolean>;
  /** Turns an invitation link into a signed-in account. */
  acceptInvite: (input: AcceptInviteInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

type SessionResponse = SessionDto | { user: null; workspaces: []; activeWorkspaceId: null };

/** What /auth/register answers when the address still has to be proven. */
interface PendingVerification {
  verificationRequired: true;
  email: string;
}

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
    // Two possible answers: a session when mail is off, or a note that a
    // verification link is on its way. Only the first one signs anybody in.
    mutationFn: (input: RegisterInput) =>
      api.post<SessionDto | PendingVerification>('/auth/register', input),
    onSuccess: (result) => {
      if ('verificationRequired' in result) return;
      queryClient.setQueryData(qk.session, result);
      setPreferredWorkspaceId(result.activeWorkspaceId);
    },
  });

  const joinMutation = useMutation({
    mutationFn: (input: JoinWithCodeInput) =>
      api.post<SessionDto | PendingVerification>('/auth/join', input),
    onSuccess: (result) => {
      if ('verificationRequired' in result) return;
      queryClient.setQueryData(qk.session, result);
      setPreferredWorkspaceId(result.activeWorkspaceId);
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: (input: AcceptInviteInput) => api.post<SessionDto>('/auth/accept-invite', input),
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
      register: async (input) => {
        const result = await registerMutation.mutateAsync(input);
        return 'verificationRequired' in result;
      },
      joinWithCode: async (input) => {
        const result = await joinMutation.mutateAsync(input);
        return 'verificationRequired' in result;
      },
      acceptInvite: async (input) => void (await acceptInviteMutation.mutateAsync(input)),
      logout: async () => void (await logoutMutation.mutateAsync()),
      refresh: async () => void (await queryClient.invalidateQueries({ queryKey: qk.session })),
    }),
    [user, workspaces, workspace, isLoading, setPreferredWorkspaceId, loginMutation, registerMutation, joinMutation, acceptInviteMutation, logoutMutation, queryClient],
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

/**
 * Whether open sign-up is allowed. Fetched without a session, so the sign-in
 * screens can offer the path that actually works — a closed registration form
 * would otherwise be a dead end for someone holding a join code.
 */
export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<{ registrationOpen: boolean }>('/auth/config'),
    staleTime: 5 * 60_000,
  });
}
