import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Upload } from 'lucide-react';
import { ApiError, api } from '~/lib/api';
import { isTelegramApp, telegramInitData } from '~/lib/telegramApp';
import { qk } from '~/lib/queryKeys';
import { useAuthConfig, useSession } from '~/app/session';
import { useToast } from '~/app/toast';
import { Topbar } from '~/components/Topbar';
import { Marker, Masthead } from '~/ui/Masthead';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { Checkbox, Input, Select } from '~/ui/Input';

/** Every Russian zone first, by its city; then a few common foreign ones. */
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Петропавловск-Камчатский (UTC+12)' },
  { value: 'Europe/Minsk', label: 'Минск (UTC+3)' },
  { value: 'Asia/Almaty', label: 'Алматы (UTC+5)' },
  { value: 'Asia/Tashkent', label: 'Ташкент (UTC+5)' },
  { value: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
  { value: 'Europe/Berlin', label: 'Берлин (UTC+1)' },
  { value: 'Europe/London', label: 'Лондон (UTC+0)' },
  { value: 'UTC', label: 'UTC' },
];

export function AccountSettingsPage() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState({
    name: user?.name ?? '',
    timezone: user?.timezone ?? 'UTC',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const photoInputRef = useRef<HTMLInputElement>(null);

  const updateProfile = useMutation({
    mutationFn: (input: { name: string; timezone: string }) => api.patch('/me', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.session });
      await refresh();
      toast.success('Профиль обновлён');
    },
    onError: (error) => toast.error(error, 'Не удалось обновить профиль'),
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<{ avatarUrl: string }>('/me/avatar', form);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.session });
      toast.success('Фото обновлено');
    },
    onError: (error) => toast.error(error, 'Не удалось загрузить фото'),
  });
  const removePhoto = useMutation({
    mutationFn: () => api.delete<void>('/me/avatar'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.session });
      toast.success('Фото убрано', 'Вместо него показываются инициалы.');
    },
    onError: (error) => toast.error(error, 'Не удалось убрать фото'),
  });

  const { data: config } = useAuthConfig();
  const updateNotifications = useMutation({
    mutationFn: (emailNotifications: boolean) => api.patch('/me', { emailNotifications }),
    onSuccess: async (_, emailNotifications) => {
      await queryClient.invalidateQueries({ queryKey: qk.session });
      toast.success(emailNotifications ? 'Письма включены' : 'Письма выключены');
    },
    onError: (error) => toast.error(error, 'Не удалось сохранить настройку'),
  });

  // Connecting Telegram happens in the bot, outside this page: the link opens
  // it, and the page keeps asking the server until the account shows as connected.
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const telegramLinked = user?.telegramLinked ?? false;
  useEffect(() => {
    if (!telegramLink || telegramLinked) return;
    const poll = window.setInterval(() => void refresh(), 3_000);
    // The link itself stops working after fifteen minutes.
    const giveUp = window.setTimeout(() => setTelegramLink(null), 15 * 60_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(giveUp);
    };
  }, [telegramLink, telegramLinked, refresh]);
  useEffect(() => {
    if (telegramLinked) setTelegramLink(null);
  }, [telegramLinked]);

  const connectTelegram = useMutation({
    mutationFn: () => api.post<{ url: string }>('/me/telegram/link'),
    onError: (error) => toast.error(error, 'Не удалось получить ссылку на бота'),
  });
  // Opened inside Telegram, the page already holds Telegram's signed word on
  // who is looking at it — connecting takes one tap and no trip to the bot.
  const connectThisTelegram = useMutation({
    mutationFn: () => api.post<void>('/me/telegram/link-app', { initData: telegramInitData() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.session });
      toast.success('Telegram подключён', 'Уведомления придут сюда, а Analysium откроется без пароля.');
    },
    onError: (error) => toast.error(error, 'Не удалось подключить Telegram'),
  });
  const disconnectTelegram = useMutation({
    mutationFn: () => api.delete<void>('/me/telegram'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.session });
      toast.success('Telegram отключён', 'Уведомления снова будут приходить на почту.');
    },
    onError: (error) => toast.error(error, 'Не удалось отключить Telegram'),
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

  const profileDirty = profile.name !== user.name || profile.timezone !== user.timezone;

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
                  user={{ id: user.id, name: profile.name || user.name, avatarUrl: user.avatarUrl }}
                  size="xl"
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={<Upload className="size-3.5" />}
                      loading={uploadPhoto.isPending}
                      onClick={() => photoInputRef.current?.click()}
                    >
                      {user.avatarUrl ? 'Заменить фото' : 'Загрузить фото'}
                    </Button>
                    {user.avatarUrl && (
                      <Button size="sm" variant="ghost" loading={removePhoto.isPending} onClick={() => removePhoto.mutate()}>
                        Убрать
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-subtle">
                    PNG, JPG, WebP или GIF до 2 МБ. Без фото показываются инициалы.
                  </p>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label="Фото профиля"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      // Checked here too, so a big file is refused before it is sent.
                      if (file.size > 2 * 1024 * 1024) {
                        toast.toast({ tone: 'error', title: 'Фото больше 2 МБ', description: 'Выберите файл поменьше.' });
                        return;
                      }
                      uploadPhoto.mutate(file);
                    }}
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
                {/* A zone saved before this list existed stays selectable. */}
                {!TIMEZONES.some((zone) => zone.value === profile.timezone) && (
                  <option value={profile.timezone}>{profile.timezone}</option>
                )}
                {TIMEZONES.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </Select>

              <Button
                variant="primary"
                size="sm"
                disabled={!profileDirty}
                loading={updateProfile.isPending}
                onClick={() => updateProfile.mutate({ name: profile.name, timezone: profile.timezone })}
              >
                Сохранить профиль
              </Button>
            </div>
          </section>

          <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
            <h2 className="fd-eyebrow">Уведомления</h2>
            <div className="mt-3">
              <Checkbox
                checked={user.emailNotifications}
                disabled={config?.mailEnabled === false || updateNotifications.isPending}
                onChange={(event) => updateNotifications.mutate(event.target.checked)}
                label="Присылать непрочитанные уведомления на почту"
              />
              <p className="mt-1 pl-6 text-xs text-text-subtle">
                {config?.mailEnabled === false
                  ? 'На этом сервере почта выключена — письма начнут приходить, когда администратор её включит.'
                  : `Письмо на ${user.email} приходит, только если уведомление пролежало непрочитанным 10 минут. Несколько уведомлений собираются в одно письмо — не чаще раза в полчаса.`}
              </p>
            </div>

            {config?.telegramEnabled && (
              <div className="mt-4 border-t-2 border-border-strong pt-3">
                <p className="text-sm font-bold">Telegram</p>
                {telegramLinked ? (
                  <>
                    <p className="mt-1 text-xs text-text-subtle">
                      Подключён. Уведомления приходят в Telegram сразу, со ссылкой на задачу; письма их не повторяют.
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      loading={disconnectTelegram.isPending}
                      onClick={() => disconnectTelegram.mutate()}
                    >
                      Отключить Telegram
                    </Button>
                  </>
                ) : isTelegramApp() ? (
                  <>
                    <p className="mt-1 text-xs text-text-subtle">
                      Вы открыли Analysium из Telegram. Подключите его к аккаунту — уведомления будут приходить сюда
                      сразу, а трекер открываться без пароля.
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      iconLeft={<Send className="size-3.5" />}
                      loading={connectThisTelegram.isPending}
                      onClick={() => connectThisTelegram.mutate()}
                    >
                      Подключить этот Telegram
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-text-subtle">
                      Уведомления будут приходить в Telegram сразу. Откроется бот — нажмите в нём «Запустить».
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        iconLeft={<Send className="size-3.5" />}
                        loading={connectTelegram.isPending}
                        onClick={() => {
                          // Opened right in the click, before the link is known: a
                          // tab opened after the answer arrives is treated as a pop-up.
                          const tab = window.open('', '_blank');
                          connectTelegram.mutate(undefined, {
                            onSuccess: ({ url }) => {
                              setTelegramLink(url);
                              if (tab) tab.location.href = url;
                            },
                            onError: () => tab?.close(),
                          });
                        }}
                      >
                        Подключить Telegram
                      </Button>
                      {telegramLink && (
                        <a
                          href={telegramLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-accent underline hover:no-underline"
                        >
                          Бот не открылся? Открыть по ссылке
                        </a>
                      )}
                    </div>
                    {telegramLink && (
                      <p className="mt-2 text-xs text-text-subtle">
                        Ждём, пока вы нажмёте «Запустить» в боте… Ссылка действует 15 минут.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
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
