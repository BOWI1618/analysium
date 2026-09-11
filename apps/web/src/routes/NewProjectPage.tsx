import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { useMembers } from '~/features/members/hooks';
import { useCreateProject } from '~/features/projects/hooks';
import { Topbar } from '~/components/Topbar';
import { Button } from '~/ui/Button';
import { Input, Select, Textarea } from '~/ui/Input';

const ICONS = ['📦', '🌐', '📱', '🛠️', '🚀', '🎨', '🔐', '📊', '⚙️', '🧪', '💬', '🧭'];
const COLORS = ['#6b46f5', '#ec4899', '#14b8a6', '#f59e0b', '#0ea5e9', '#ef4444', '#22c55e', '#8b5cf6'];

/** Derives a project key from the name: "Mobile App" → "MOB". */
function suggestKey(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!.replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return words
    .map((word) => word.replace(/[^A-Z0-9]/g, '')[0] ?? '')
    .join('')
    .slice(0, 4);
}

export function NewProjectPage() {
  const { workspace } = useSession();
  const navigate = useNavigate();
  const workspaceId = workspace?.id ?? '';

  const { data: members } = useMembers(workspaceId);
  const createProject = useCreateProject(workspaceId);

  const [form, setForm] = useState({
    name: '',
    key: '',
    description: '',
    icon: '📦',
    color: '#6b46f5',
    projectType: 'KANBAN',
    leadId: '',
  });
  const [keyTouched, setKeyTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    try {
      const project = await createProject.mutateAsync({
        name: form.name.trim(),
        key: form.key.trim().toUpperCase(),
        description: form.description.trim() || undefined,
        icon: form.icon,
        color: form.color,
        projectType: form.projectType,
        leadId: form.leadId || null,
      });
      navigate(`/projects/${project.id}`);
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(error.fields);
    }
  };

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Проекты', to: '/projects' }, { label: 'Новый проект' }]} />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <form className="mx-auto max-w-xl space-y-4 p-4 sm:p-6" onSubmit={submit}>
          <header>
            <h1 className="text-lg font-semibold">Новый проект</h1>
            <p className="text-sm text-text-muted">
              У проекта своя доска, рабочий процесс и метки. Всё это можно изменить позже.
            </p>
          </header>

          <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <Input
              label="Название"
              autoFocus
              required
              value={form.name}
              error={fieldErrors.name}
              onChange={(event) => {
                const name = event.target.value;
                setForm((f) => ({ ...f, name, key: keyTouched ? f.key : suggestKey(name) }));
              }}
              placeholder="Мобильное приложение"
            />

            <Input
              label="Ключ"
              required
              value={form.key}
              error={fieldErrors.key}
              onChange={(event) => {
                setKeyTouched(true);
                setForm((f) => ({ ...f, key: event.target.value.toUpperCase() }));
              }}
hint="2–6 символов. Задачи получат номера вида MOB-1, MOB-2 — изменить потом нельзя."
              maxLength={6}
              className="fd-num uppercase"
              placeholder="MOB"
            />

            <Textarea
              label="Описание"
              value={form.description}
              rows={2}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              placeholder="Для чего этот проект?"
            />

            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-text-muted">Иконка</legend>
              <div className="flex flex-wrap gap-1.5">
                {ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, icon }))}
                    aria-pressed={form.icon === icon}
                    aria-label={`Иконка ${icon}`}
                    className={
                      form.icon === icon
                        ? 'flex size-8 items-center justify-center rounded-md border-2 border-accent bg-accent-subtle'
                        : 'flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-hover'
                    }
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-text-muted">Цвет</legend>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color }))}
                    aria-pressed={form.color === color}
                    aria-label={`Цвет ${color}`}
                    className="size-7 rounded-md ring-offset-2 ring-offset-[var(--surface)]"
                    style={{
                      backgroundColor: color,
                      boxShadow: form.color === color ? `0 0 0 2px var(--surface), 0 0 0 4px ${color}` : undefined,
                    }}
                  />
                ))}
              </div>
            </fieldset>

            <Select
              label="Методология"
              value={form.projectType}
              onChange={(event) =>
                setForm((f) => ({ ...f, projectType: (event.target as HTMLSelectElement).value }))
              }
            >
              <option value="KANBAN">Канбан — непрерывный поток на доске</option>
              <option value="SCRUM">Скрам — спринты, бэклог и velocity</option>
              <option value="SIMPLE">Простой — обычный список работ</option>
            </Select>

            <Select
              label="Ведущий проекта"
              value={form.leadId}
              onChange={(event) => setForm((f) => ({ ...f, leadId: (event.target as HTMLSelectElement).value }))}
            >
              <option value="">Я</option>
              {members?.map((member) => (
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
              disabled={!form.name.trim() || form.key.trim().length < 2}
            >
              Создать проект
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
