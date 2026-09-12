import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useSession } from '~/app/session';
import { useToast } from '~/app/toast';
import { Topbar } from '~/components/Topbar';
import { Marker, Masthead } from '~/ui/Masthead';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { Input, Select } from '~/ui/Input';

const TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function AccountSettingsPage() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState({
    name: user?.name ?? '',
    avatarUrl: user?.avatarUrl ?? '',
    timezone: user?.timezone ?? 'UTC',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  const updateProfile = useMutation({
    mutationFn: (input: { name: string; avatarUrl: string | null; timezone: string }) =>
      api.patch('/me', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.session });
      await refresh();
      toast.success('Профиль обновлён');
    },
    onError: (error) => toast.error(error, 'Не удалось обновить профиль'),
  });

  const changePassword = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<void>('/me/password', input),
    onSuccess: () => {
      setPasswords({ currentPassword: '', newPassword: '' });
      setPasswordErrors({});
      toast.success('Пароль изменён', 'На других устройствах выполнен выход.');
    },
    onError: (error) => {
      if (error instanceof ApiError) setPasswordErrors(error.fields);
      toast.error(error, 'Не удалось изменить пароль');
    },
  });

  if (!user) return null;

  const profileDirty =
    profile.name !== user.name ||
    profile.avatarUrl !== (user.avatarUrl ?? '') ||
    profile.timezone !== user.timezone;

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Настройки' }]} />

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
        <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6 lg:p-8">
          <Masthead
            size="md"
            kicker="аккаунт"
            title={
              <>
                Ваши <Marker>настройки</Marker>
              </>
            }
          />

          <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
            <h2 className="fd-eyebrow">Профиль</h2>
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-3">
                <Avatar
                  user={{ id: user.id, name: profile.name || user.name, avatarUrl: profile.avatarUrl || null }}
                  size="xl"
                />
                <div className="flex-1">
                  <Input
                    label="Ссылка на аватар"
                    value={profile.avatarUrl}
                    onChange={(event) => setProfile((p) => ({ ...p, avatarUrl: event.target.value }))}
                    placeholder="https://…"
                    hint="Оставьте пустым — будут показаны инициалы."
                  />
                </div>
              </div>

              <Input
                label="Имя"
                value={profile.name}
                onChange={(event) => setProfile((p) => ({ ...p, name: event.target.value }))}
              />

              <Input label="Почта" value={user.email} disabled hint="Чтобы сменить почту, обратитесь к администратору." />

              <Select
                label="Часовой пояс"
                value={profile.timezone}
                onChange={(event) => setProfile((p) => ({ ...p, timezone: (event.target as HTMLSelectElement).value }))}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>

              <Button
                variant="primary"
                size="sm"
                disabled={!profileDirty}
                loading={updateProfile.isPending}
                onClick={() =>
                  updateProfile.mutate({
                    name: profile.name,
                    avatarUrl: profile.avatarUrl || null,
                    timezone: profile.timezone,
                  })
                }
              >
                Сохранить профиль
              </Button>
            </div>
          </section>

          <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
            <h2 className="fd-eyebrow">Пароль</h2>
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                changePassword.mutate(passwords);
              }}
            >
              <Input
                label="Текущий пароль"
                type="password"
                autoComplete="current-password"
                required
                value={passwords.currentPassword}
                error={passwordErrors.currentPassword}
                onChange={(event) => setPasswords((p) => ({ ...p, currentPassword: event.target.value }))}
              />
              <Input
                label="Новый пароль"
                type="password"
                autoComplete="new-password"
                required
                value={passwords.newPassword}
                error={passwordErrors.newPassword}
                hint="Минимум 8 символов, включая букву и цифру."
                onChange={(event) => setPasswords((p) => ({ ...p, newPassword: event.target.value }))}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                loading={changePassword.isPending}
                disabled={!passwords.currentPassword || !passwords.newPassword}
              >
                Изменить пароль
              </Button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
