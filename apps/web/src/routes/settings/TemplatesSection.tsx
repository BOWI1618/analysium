import { useMemo, useState } from 'react';
import type {
  IssuePriority,
  IssueRecurrence,
  IssueTemplateDto,
  IssueType,
  UserSummaryDto,
} from '@flowdesk/contracts';
import { EMPTY_DOC, ISSUE_RECURRENCES, docToText, isDocEmpty } from '@flowdesk/contracts';
import { ChevronDown, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { useToast } from '~/app/toast';
import { useMembers } from '~/features/members/hooks';
import {
  useDeleteIssueTemplate,
  useIssueTemplates,
  useSaveIssueTemplate,
  type IssueTemplateForm,
} from '~/features/templates/hooks';
import { RichTextEditor } from '~/components/RichText';
import { MultiSelect, PriorityPicker, TypePicker } from '~/components/Pickers';
import { IssueTypeIcon, ISSUE_TYPE_META, PriorityIcon, PRIORITY_META } from '~/components/IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { Button, IconButton } from '~/ui/Button';
import { ConfirmDialog, Dialog, DialogCloseButton } from '~/ui/Dialog';
import { EmptyState, Skeleton } from '~/ui/Feedback';
import { Input, Textarea } from '~/ui/Input';
import { RECURRENCE_LABEL } from '~/lib/labels';
import { pluralize } from '~/lib/format';

const EMPTY_FORM: IssueTemplateForm = {
  name: '',
  title: '',
  description: EMPTY_DOC,
  type: 'TASK',
  priority: 'MEDIUM',
  dueInDays: null,
  storyPoints: null,
  recurrence: null,
  subtasks: [],
  watcherIds: [],
};

/** A checklist as the editor stores it. */
const checklist = (...items: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: items.map((text) => ({
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })),
    },
  ],
});

/**
 * Four kinds of work every office repeats. Offered on an empty list, so that
 * the first template is edited from an example rather than invented from a
 * blank form; nothing is added without being asked for.
 */
const EXAMPLES: IssueTemplateForm[] = [
  {
    ...EMPTY_FORM,
    name: 'Совещание',
    title: 'Совещание',
    description: checklist('Повестка согласована', 'Участники приглашены', 'Протокол разослан'),
    dueInDays: 3,
  },
  {
    ...EMPTY_FORM,
    name: 'Подготовить ТЗ',
    title: 'Подготовить ТЗ',
    priority: 'HIGH',
    dueInDays: 10,
    subtasks: ['Собрать требования', 'Написать черновик', 'Согласовать с заказчиком'],
  },
  {
    ...EMPTY_FORM,
    name: 'Согласование',
    title: 'Согласование',
    description: checklist('Документ приложен', 'Замечания учтены', 'Решение записано'),
    dueInDays: 2,
  },
  {
    ...EMPTY_FORM,
    name: 'Регулярная проверка',
    title: 'Регулярная проверка',
    description: checklist('Проверка проведена', 'Отклонения записаны'),
    dueInDays: 7,
    recurrence: 'WEEKLY',
  },
];

const toForm = (template: IssueTemplateDto): IssueTemplateForm => ({
  id: template.id,
  name: template.name,
  title: template.title,
  description: template.description ?? EMPTY_DOC,
  type: template.type,
  priority: template.priority,
  dueInDays: template.dueInDays,
  storyPoints: template.storyPoints,
  recurrence: template.recurrence,
  subtasks: template.subtasks,
  watcherIds: template.watchers.map((watcher) => watcher.id),
});

/** What a template brings besides its text, in a few words for the list. */
function summary(template: IssueTemplateDto): string {
  const parts: string[] = [];
  if (template.dueInDays !== null) {
    parts.push(template.dueInDays === 0 ? 'срок — в день создания' : `срок через ${pluralize(template.dueInDays, ['день', 'дня', 'дней'])}`);
  }
  if (template.subtasks.length) parts.push(pluralize(template.subtasks.length, ['подзадача', 'подзадачи', 'подзадач']));
  if (template.recurrence) parts.push(`повтор ${RECURRENCE_LABEL[template.recurrence]}`);
  if (template.watchers.length) parts.push(pluralize(template.watchers.length, ['наблюдатель', 'наблюдателя', 'наблюдателей']));
  return parts.join(' · ') || 'только название и описание';
}

/**
 * «Шаблоны задач»: typical work written down once — a meeting, an approval, a
 * regular check — and picked in the create form instead of being typed anew.
 */
export function TemplatesSection() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const toast = useToast();
  const { data, isLoading } = useIssueTemplates(workspaceId);
  const { data: members } = useMembers(workspaceId);
  const save = useSaveIssueTemplate(workspaceId);
  const remove = useDeleteIssueTemplate(workspaceId);

  const [form, setForm] = useState<IssueTemplateForm | null>(null);
  const [removing, setRemoving] = useState<IssueTemplateDto | null>(null);
  const [addingExamples, setAddingExamples] = useState(false);

  const people = useMemo(() => (members ?? []).map((member) => member.user), [members]);
  const templates = data?.items ?? [];

  const addExamples = async () => {
    setAddingExamples(true);
    try {
      for (const example of EXAMPLES) await save.mutateAsync(example);
      toast.success('Добавлены четыре примера — измените их под себя');
    } catch (error) {
      toast.error(error, 'Не удалось добавить примеры');
    } finally {
      setAddingExamples(false);
    }
  };

  return (
    <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="fd-eyebrow">Шаблоны задач</h2>
          <p className="mt-1 max-w-prose text-xs text-text-muted">
            Типовая работа, записанная один раз: название, описание с чек-листом, подзадачи, срок и наблюдатели.
            Шаблон выбирают в форме новой задачи — она заполняется сама, и перед созданием всё можно поправить.
          </p>
        </div>
        <Button size="sm" variant="primary" iconLeft={<Plus className="size-3.5" />} onClick={() => setForm(EMPTY_FORM)}>
          Новый шаблон
        </Button>
      </div>

      <div className="mt-3.5">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : templates.length === 0 ? (
          <EmptyState
            compact
            title="Шаблонов пока нет"
            description="Начните с примеров — «Совещание», «Подготовить ТЗ», «Согласование», «Регулярная проверка» — и измените их под себя."
            action={
              <Button size="sm" variant="secondary" loading={addingExamples} onClick={() => void addExamples()}>
                Добавить примеры
              </Button>
            }
          />
        ) : (
          <ul className="divide-y-2 divide-border-strong border-2 border-border-strong" aria-label="Шаблоны задач">
            {templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
                <IssueTypeIcon type={template.type} withTooltip={false} className="size-4 shrink-0" />
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="truncate text-sm font-bold">{template.name}</h3>
                  <p className="mt-0.5 truncate text-xs text-text-muted">{summary(template)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    iconLeft={<Pencil className="size-3" />}
                    onClick={() => setForm(toForm(template))}
                  >
                    Изменить
                  </Button>
                  <IconButton label={`Удалить шаблон «${template.name}»`} size="sm" onClick={() => setRemoving(template)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {form && <TemplateDialog workspaceId={workspaceId} initial={form} people={people} onClose={() => setForm(null)} />}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(removing, { onSettled: () => setRemoving(null) });
        }}
        title={`Удалить шаблон «${removing?.name ?? ''}»?`}
        message="Задачи, уже созданные по этому шаблону, останутся как были."
        confirmLabel="Удалить шаблон"
        danger
        loading={remove.isPending}
      />
    </section>
  );
}

function TemplateDialog({
  workspaceId,
  initial,
  people,
  onClose,
}: {
  workspaceId: string;
  initial: IssueTemplateForm;
  people: UserSummaryDto[];
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveIssueTemplate(workspaceId);
  const [name, setName] = useState(initial.name);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState<unknown>(initial.description);
  const [type, setType] = useState<IssueType>(initial.type);
  const [priority, setPriority] = useState<IssuePriority>(initial.priority);
  const [dueInDays, setDueInDays] = useState<number | null>(initial.dueInDays);
  const [storyPoints, setStoryPoints] = useState<number | null>(initial.storyPoints);
  const [recurrence, setRecurrence] = useState<IssueRecurrence | null>(initial.recurrence);
  const [subtasks, setSubtasks] = useState(initial.subtasks.join('\n'));
  const [watcherIds, setWatcherIds] = useState(initial.watcherIds);
  const [errors, setErrors] = useState<{ name?: string; title?: string }>({});

  // Compared by value, and the description by its text: the editor may put the
  // same document back in a slightly different shape without anyone typing.
  const dirty =
    name !== initial.name ||
    title !== initial.title ||
    type !== initial.type ||
    priority !== initial.priority ||
    dueInDays !== initial.dueInDays ||
    storyPoints !== initial.storyPoints ||
    recurrence !== initial.recurrence ||
    subtasks !== initial.subtasks.join('\n') ||
    watcherIds.join() !== initial.watcherIds.join() ||
    docToText(description) !== docToText(initial.description);
  /** A whole number within bounds, or nothing for an empty field. */
  const numberIn = (raw: string, max: number) => {
    const value = Math.round(Number(raw));
    return raw === '' || !Number.isFinite(value) ? null : Math.min(max, Math.max(0, value));
  };

  const submit = () => {
    const problems = {
      name: name.trim() ? undefined : 'Укажите название шаблона',
      title: title.trim() ? undefined : 'Укажите, как назвать задачу',
    };
    setErrors(problems);
    if (problems.name || problems.title) return;

    save.mutate(
      {
        id: initial.id,
        name: name.trim(),
        title: title.trim(),
        description: isDocEmpty(description) ? null : description,
        type,
        priority,
        dueInDays,
        storyPoints,
        recurrence,
        subtasks: subtasks
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        watcherIds,
      },
      {
        onSuccess: (template) => {
          toast.success(initial.id ? `Шаблон «${template.name}» сохранён` : `Шаблон «${template.name}» создан`);
          onClose();
        },
        onError: (error) => {
          // A taken name is shown at the field; anything else has no field to sit at.
          if (error instanceof ApiError && error.fields.name) setErrors({ name: error.fields.name });
          else toast.error(error, 'Не удалось сохранить шаблон');
        },
      },
    );
  };

  const caption = 'mb-1 block text-xs font-bold text-text';
  const field =
    'h-8 w-full rounded-md border-2 border-border-strong bg-surface px-2.5 text-sm hover:shadow-xs focus:border-accent focus:outline-none';
  const trigger =
    'inline-flex h-8 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2.5 text-sm hover:bg-surface-hover hover:shadow-xs';

  return (
    <Dialog
      open
      onClose={onClose}
      dirty={dirty}
      title={initial.id ? 'Шаблон задачи' : 'Новый шаблон задачи'}
      size="lg"
      footer={
        <>
          <DialogCloseButton size="sm" variant="ghost">
            Отмена
          </DialogCloseButton>
          <Button size="sm" variant="primary" loading={save.isPending} onClick={submit}>
            {initial.id ? 'Сохранить' : 'Создать шаблон'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            data-autofocus="true"
            label="Название шаблона"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
            error={errors.name}
            maxLength={60}
            placeholder="Например, «Совещание»"
            hint="Под этим названием шаблон стоит в списке."
          />
          <Input
            label="Название задачи"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
            error={errors.title}
            maxLength={300}
            placeholder="С чего начнётся название новой задачи"
            hint="Его дополняют уже в форме задачи."
          />
        </div>

        <div>
          <p className={caption}>Описание</p>
          <RichTextEditor
            value={description}
            onChange={setDescription}
            users={people}
            placeholder="Что входит в такую работу: порядок действий, чек-лист…"
            minHeight="6rem"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className={caption}>Тип</p>
            <TypePicker value={type} onChange={setType}>
              <button type="button" className={trigger} aria-label={`Тип: ${ISSUE_TYPE_META[type].label}`}>
                <IssueTypeIcon type={type} withTooltip={false} className="size-3.5" />
                {ISSUE_TYPE_META[type].label}
                <ChevronDown className="size-3 text-text-subtle" />
              </button>
            </TypePicker>
          </div>
          <div>
            <p className={caption}>Приоритет</p>
            <PriorityPicker value={priority} onChange={setPriority}>
              <button type="button" className={trigger} aria-label={`Приоритет: ${PRIORITY_META[priority].label}`}>
                <PriorityIcon priority={priority} withTooltip={false} className="size-3.5" />
                {PRIORITY_META[priority].label}
                <ChevronDown className="size-3 text-text-subtle" />
              </button>
            </PriorityPicker>
          </div>
          <div className="w-40">
            <label htmlFor="template-due" className={caption}>
              Срок, дней от создания
            </label>
            <input
              id="template-due"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              value={dueInDays ?? ''}
              onChange={(event) => setDueInDays(numberIn(event.target.value, 365))}
              placeholder="без срока"
              className={`fd-num ${field}`}
            />
          </div>
          <div className="w-32">
            <label htmlFor="template-points" className={caption}>
              Оценка, баллы
            </label>
            <input
              id="template-points"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={storyPoints ?? ''}
              onChange={(event) => setStoryPoints(numberIn(event.target.value, 100))}
              placeholder="—"
              className={`fd-num ${field}`}
            />
          </div>
          <div className="w-44">
            <label htmlFor="template-recurrence" className={caption}>
              Повтор
            </label>
            <select
              id="template-recurrence"
              value={recurrence ?? ''}
              onChange={(event) => setRecurrence((event.target.value || null) as IssueRecurrence | null)}
              className={field}
            >
              <option value="">Не повторять</option>
              {ISSUE_RECURRENCES.map((rule) => (
                <option key={rule} value={rule}>
                  {RECURRENCE_LABEL[rule].charAt(0).toUpperCase() + RECURRENCE_LABEL[rule].slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {recurrence && (
          <p className="-mt-2 text-xs text-text-subtle">
            Повтор срабатывает после закрытия: когда задачу завершат, появится следующая — со сдвинутым сроком. По
            календарю, независимо от закрытия, задачи не создаются.
          </p>
        )}

        <Textarea
          label="Подзадачи"
          value={subtasks}
          onChange={(event) => setSubtasks(event.target.value)}
          rows={3}
          placeholder={'По одной в строке, например:\nСобрать требования\nНаписать черновик'}
          hint="Создаются вместе с задачей; в форме задачи от них можно отказаться."
        />

        <div>
          <p className={caption}>Наблюдатели</p>
          <MultiSelect
            title="Наблюдатели шаблона"
            options={people.map((person) => ({
              value: person.id,
              label: person.name,
              icon: <Avatar user={person} size="sm" />,
            }))}
            value={watcherIds}
            onChange={setWatcherIds}
          >
            <button type="button" className={trigger} aria-label={`Наблюдатели шаблона: ${watcherIds.length || 'нет'}`}>
              <Eye className="size-3.5 text-text-subtle" />
              {watcherIds.length
                ? pluralize(watcherIds.length, ['наблюдатель', 'наблюдателя', 'наблюдателей'])
                : 'Никто'}
              <ChevronDown className="size-3 text-text-subtle" />
            </button>
          </MultiSelect>
          <p className="mt-1 text-xs text-text-subtle">
            Получают уведомления о каждой задаче по шаблону — если у них есть доступ к её проекту.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
