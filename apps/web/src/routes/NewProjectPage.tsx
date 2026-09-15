import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { useMembers } from '~/features/members/hooks';
import { useCreateProject } from '~/features/projects/hooks';
import { Topbar } from '~/components/Topbar';
import { Button } from '~/ui/Button';
import { Input, Select, Textarea } from '~/ui/Input';
import { PROJECT_ICONS, PROJECT_COLORS } from '~/lib/projectMeta';
import { Marker, Masthead } from '~/ui/Masthead';
import { useLeavePageGuard } from '~/lib/hooks/useLeavePageGuard';

export function NewProjectPage() {
  const { workspace, user } = useSession();
  const navigate = useNavigate();
  const workspaceId = workspace?.id ?? '';

  const { data: members } = useMembers(workspaceId);
  const createProject = useCreateProject(workspaceId);

  const [form, setForm] = useState({
    name: '',
    description: '',
    icon: PROJECT_ICONS[0]!.name,
    color: PROJECT_COLORS[0]!.value,
    leadId: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const leaveGuard = useLeavePageGuard(Boolean(form.name.trim() || form.description.trim()));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    try {
      const project = await createProject.mutateAsync({
        // No key: the server derives a unique one from the name.
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        icon: form.icon,
        color: form.color,
        // Sprints are switched on later in the project settings, when wanted.
        projectType: 'KANBAN',
        leadId: form.leadId || null,
      });
      leaveGuard.allowLeave();
      navigate(`/projects/${project.id}`);
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(error.fields);
    }
  };

  return (
    <>
      {leaveGuard.dialog}
      <Topbar breadcrumbs={[{ label: 'Проекты', to: '/projects' }, { label: 'Новый проект' }]} />

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
        <form className="mx-auto max-w-xl space-y-6 p-4 sm:p-6 lg:p-8" onSubmit={submit}>
          <Masthead
            size="md"
            kicker="новый проект"
            title={
              <>
                Заводим <Marker>проект</Marker>
              </>
            }
            note="У проекта своя доска, рабочий процесс и метки. Всё это можно изменить позже."
          />

          <div className="space-y-3 border-2 border-border-strong bg-surface p-4 shadow-lg">
            <Input
              label="Название"
              autoFocus
              required
              value={form.name}
              error={fieldErrors.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              placeholder="Мобильное приложение"
            />

            <Textarea
              label="Описание"
              value={form.description}
              rows={2}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              placeholder="Для чего этот проект?"
            />

            <fieldset>
              <legend className="mb-1.5 text-xs font-bold text-text">Иконка</legend>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_ICONS.map(({ name, label, Icon }) => {
                  const selected = form.icon === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, icon: name }))}
                      aria-pressed={selected}
                      aria-label={`Иконка «${label}»`}
                      title={label}
                      className={clsx(
                        'flex size-8 items-center justify-center transition-colors',
                        selected
                          ? 'border-2 border-accent bg-marker-subtle text-accent'
                          : 'border-2 border-border-strong bg-surface text-text hover:bg-surface-hover',
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-xs font-bold text-text">Цвет</legend>
              <div className="flex flex-wrap gap-2">
                {PROJECT_COLORS.map(({ value, label }) => {
                  const selected = form.color === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, color: value }))}
                      aria-pressed={selected}
                      aria-label={`Цвет: ${label}`}
                      title={label}
                      className="size-7 border-2 border-border-strong"
                      style={{
                        backgroundColor: value,
                        boxShadow: selected
                          ? `0 0 0 2px var(--surface), 0 0 0 4px var(--border-strong)`
                          : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </fieldset>

            <Select
              label="Ведущий проекта"
              value={form.leadId}
              onChange={(event) => setForm((f) => ({ ...f, leadId: (event.target as HTMLSelectElement).value }))}
            >
              <option value="">Я</option>
              {/* "Я" above already stands for the current user. */}
              {members?.filter((member) => member.user.id !== user?.id).map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  {member.user.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate('/projects')}>
              Отмена
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={createProject.isPending}
              disabled={!form.name.trim()}
            >
              Создать проект
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
