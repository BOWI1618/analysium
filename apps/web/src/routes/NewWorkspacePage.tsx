import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceDto } from '@flowdesk/contracts';
import { ApiError, api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useAuthConfig, useSession } from '~/app/session';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';
import { useLeavePageGuard } from '~/lib/hooks/useLeavePageGuard';

export function NewWorkspacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { switchWorkspace, workspaces, logout } = useSession();
  const { data: authConfig } = useAuthConfig();

  const [name, setName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const leaveGuard = useLeavePageGuard(name.trim().length > 0);

  const createWorkspace = useMutation({
    mutationFn: (input: { name: string }) => api.post<WorkspaceDto>('/workspaces', input),
    onSuccess: async (workspace) => {
      leaveGuard.allowLeave();
      await queryClient.invalidateQueries({ queryKey: qk.session });
      switchWorkspace(workspace.id);
      navigate('/');
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fields);
    },
  });

  // A new workspace is a place to let people into, so only an owner starts
  // one. Someone who was taken out of theirs lands here with nothing to make:
  // the page says whom to ask instead of offering a form that is refused.
  const mayCreate = Boolean(authConfig?.registrationOpen) || workspaces.some((item) => item.role === 'OWNER');
  if (authConfig && !mayCreate) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
        <div className="w-full max-w-sm space-y-4">
          <header>
            <h1 className="fd-display text-[clamp(1.5rem,2.6vw,2.125rem)]">
              {workspaces.length === 0 ? 'Нет доступа к пространству' : 'Новое пространство'}
            </h1>
            <p className="mt-3 border-t-2 border-border-strong pt-3 font-mono text-2xs leading-relaxed text-text-muted">
              {workspaces.length === 0
                ? 'Ваш аккаунт не состоит ни в одном пространстве. Доступ выдаёт владелец — попросите его добавить вас.'
                : 'Новое пространство может создать только владелец.'}
            </p>
          </header>
          {workspaces.length === 0 ? (
            <Button variant="secondary" size="lg" fullWidth onClick={() => void logout().then(() => navigate('/login'))}>
              Выйти
            </Button>
          ) : (
            <Button variant="secondary" size="lg" fullWidth onClick={() => navigate('/')}>
              На главную
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      {leaveGuard.dialog}
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFieldErrors({});
          createWorkspace.mutate({ name: name.trim() });
        }}
      >
        <header>
          <h1 className="fd-display text-[clamp(1.5rem,2.6vw,2.125rem)]">
            {workspaces.length === 0 ? 'Создайте пространство' : 'Новое пространство'}
          </h1>
          <p className="mt-3 border-t-2 border-border-strong pt-3 font-mono text-2xs leading-relaxed text-text-muted">
            В пространстве живут ваша команда, её проекты и всё, что она ведёт.
          </p>
        </header>

        <div className="border-2 border-border-strong bg-surface p-4 shadow-lg">
          <Input
            label="Название пространства"
            autoFocus
            required
            inputSize="lg"
            value={name}
            error={fieldErrors.name ?? fieldErrors.slug}
            onChange={(event) => setName(event.target.value)}
            placeholder="Acme"
          />
        </div>

        <div className="flex gap-2">
          {workspaces.length > 0 && (
            <Button variant="ghost" fullWidth onClick={() => navigate(-1)}>
              Отмена
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={createWorkspace.isPending}
            disabled={name.trim().length < 2}
          >
            Создать пространство
          </Button>
        </div>
      </form>
    </div>
  );
}
