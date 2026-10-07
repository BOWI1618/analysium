import { useState } from 'react';
import type { SavedViewDto, SavedViewLayout } from '@flowdesk/contracts';
import { Bookmark, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { useSession } from '~/app/session';
import { useToast } from '~/app/toast';
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from '~/features/views/hooks';
import { sameViewState, type ViewState } from '~/features/views/viewState';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { ConfirmDialog, Dialog, DialogCloseButton } from '~/ui/Dialog';
import { Button, IconButton } from '~/ui/Button';
import { Checkbox, Input } from '~/ui/Input';
import { EmptyState } from '~/ui/Feedback';
import { FacetButton } from './FilterBar';

interface SavedViewsProps {
  /** The screen the views belong to; a view never shows up on another one. */
  layout: SavedViewLayout;
  /** For a project's own screens: views of this project only. */
  projectId?: string;
  /** What the page shows now — what «Сохранить» writes down. */
  current: ViewState;
  onApply: (view: SavedViewDto) => void;
  /** Said in the save dialog: what exactly this page puts into a view. */
  saves: string;
}

/**
 * «Виды»: named sets of conditions for one screen, opened with one click.
 *
 * A view is personal unless its author shows it to the team. It used to be
 * saved through the browser's own prompt, was always shared, and could be
 * neither renamed nor deleted; and it existed on one screen only.
 */
export function SavedViews({ layout, projectId, current, onApply, saves }: SavedViewsProps) {
  const { workspace, user } = useSession();
  const workspaceId = workspace?.id ?? '';
  const { data: views = [] } = useSavedViews(workspace?.id, { projectId, layout });
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);

  const active = views.find((view) => sameViewState(current, view));
  const mine = views.filter((view) => view.ownerId === user?.id);
  const others = views.filter((view) => view.ownerId !== user?.id);

  const item = (view: SavedViewDto, note?: string) => (
    <MenuItem
      key={view.id}
      selected={view.id === active?.id}
      onSelect={() => onApply(view)}
      shortcut={note ? <span className="text-2xs">{note}</span> : undefined}
    >
      {view.name}
    </MenuItem>
  );

  return (
    <>
      <Menu>
        <MenuTrigger>
          <FacetButton
            label={active ? active.name : 'Виды'}
            icon={<Bookmark className="size-3" />}
            active={Boolean(active)}
          />
        </MenuTrigger>
        <MenuContent width={270} label="Сохранённые виды">
          {mine.length > 0 && (
            <>
              <MenuLabel>Мои виды</MenuLabel>
              {mine.map((view) => item(view, view.isShared ? 'общий' : undefined))}
            </>
          )}
          {others.length > 0 && (
            <>
              <MenuLabel>Виды команды</MenuLabel>
              {others.map((view) => item(view, view.ownerName.split(' ')[0]))}
            </>
          )}
          {views.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-text-subtle">
              Пока ни одного. Настройте экран как нужно и сохраните — потом он откроется одним нажатием.
            </p>
          )}
          <MenuSeparator />
          <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => setSaving(true)}>
            Сохранить текущий вид…
          </MenuItem>
          {views.length > 0 && (
            <MenuItem icon={<Settings2 className="size-3.5" />} onSelect={() => setManaging(true)}>
              Управлять видами…
            </MenuItem>
          )}
        </MenuContent>
      </Menu>

      {saving && (
        <SaveViewDialog
          workspaceId={workspaceId}
          layout={layout}
          projectId={projectId}
          current={current}
          saves={saves}
          onClose={() => setSaving(false)}
        />
      )}
      {managing && (
        <ManageViewsDialog
          workspaceId={workspaceId}
          views={views}
          current={current}
          userId={user?.id ?? ''}
          onClose={() => setManaging(false)}
        />
      )}
    </>
  );
}

function SaveViewDialog({
  workspaceId,
  layout,
  projectId,
  current,
  saves,
  onClose,
}: {
  workspaceId: string;
  layout: SavedViewLayout;
  projectId?: string;
  current: ViewState;
  saves: string;
  onClose: () => void;
}) {
  const create = useCreateSavedView(workspaceId);
  const [name, setName] = useState('');
  const [isShared, setShared] = useState(false);
  const [error, setError] = useState<string>();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Укажите название');
      return;
    }
    create.mutate(
      {
        name: trimmed,
        projectId: projectId ?? null,
        layout,
        filters: current.filters,
        display: current.display ?? null,
        isShared,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Сохранить вид"
      size="sm"
      footer={
        <>
          <DialogCloseButton size="sm" variant="ghost">
            Отмена
          </DialogCloseButton>
          <Button size="sm" variant="primary" loading={create.isPending} onClick={submit}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          data-autofocus="true"
          label="Название"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          error={error}
          maxLength={60}
          placeholder="Например, «Просроченные»"
        />
        <Checkbox
          checked={isShared}
          onChange={(event) => setShared(event.target.checked)}
          label="Показывать всей команде"
        />
        <p className="text-xs text-text-subtle">
          {isShared
            ? 'Вид появится у всех, кому доступен этот экран. Менять и удалять его сможете вы и администраторы.'
            : 'Вид будет виден только вам.'}{' '}
          {saves}
        </p>
      </div>
    </Dialog>
  );
}

function ManageViewsDialog({
  workspaceId,
  views,
  current,
  userId,
  onClose,
}: {
  workspaceId: string;
  views: SavedViewDto[];
  current: ViewState;
  userId: string;
  onClose: () => void;
}) {
  const update = useUpdateSavedView(workspaceId);
  const remove = useDeleteSavedView(workspaceId);
  const toast = useToast();
  const [deleting, setDeleting] = useState<SavedViewDto | null>(null);

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title="Сохранённые виды"
        description="Свои виды можно переименовать, показать команде, перезаписать тем, что сейчас на экране, или удалить."
        size="md"
        footer={
          <DialogCloseButton size="sm" variant="secondary">
            Готово
          </DialogCloseButton>
        }
      >
        {views.length === 0 ? (
          <EmptyState compact title="Видов не осталось" />
        ) : (
          <ul className="divide-y-2 divide-border-strong border-2 border-border-strong" aria-label="Сохранённые виды">
            {views.map((view) => (
              <li key={view.id} className="flex flex-wrap items-center gap-2 p-2">
                {view.canManage ? (
                  <>
                    <input
                      defaultValue={view.name}
                      maxLength={60}
                      onBlur={(event) => {
                        const name = event.target.value.trim();
                        if (!name) event.target.value = view.name;
                        else if (name !== view.name) update.mutate({ viewId: view.id, patch: { name } });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      aria-label={`Название вида «${view.name}»`}
                      className="h-7 min-w-32 flex-1 border-2 border-transparent bg-transparent px-1.5 text-sm font-bold hover:border-border-strong focus:border-accent focus:outline-none"
                    />
                    <Checkbox
                      checked={view.isShared}
                      disabled={update.isPending}
                      onChange={(event) => update.mutate({ viewId: view.id, patch: { isShared: event.target.checked } })}
                      aria-label={`Показывать вид «${view.name}» всей команде`}
                      label={<span className="text-xs font-normal text-text-muted">общий</span>}
                    />
                    <IconButton
                      label={`Записать в «${view.name}» то, что сейчас на экране`}
                      size="xs"
                      // Nothing to write when the view already is what the screen shows.
                      disabled={update.isPending || sameViewState(current, view)}
                      onClick={() =>
                        update.mutate(
                          { viewId: view.id, patch: { filters: current.filters, display: current.display ?? null } },
                          { onSuccess: () => toast.success(`Вид «${view.name}» обновлён`) },
                        )
                      }
                    >
                      <RefreshCw className="size-3.5" />
                    </IconButton>
                    <IconButton label={`Удалить вид «${view.name}»`} size="xs" onClick={() => setDeleting(view)}>
                      <Trash2 className="size-3.5 text-danger" />
                    </IconButton>
                    {view.ownerId !== userId && (
                      <span className="w-full px-1.5 text-2xs text-text-subtle">автор: {view.ownerName}</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate px-1.5 text-sm font-bold">{view.name}</span>
                    <span className="text-2xs text-text-subtle">общий · автор: {view.ownerName}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate({ id: deleting.id, name: deleting.name });
          setDeleting(null);
        }}
        title={`Удалить вид «${deleting?.name}»?`}
        message={
          deleting?.isShared
            ? 'Вид исчезнет у всей команды. Сами задачи не изменятся.'
            : 'Исчезнет только сохранённый набор условий. Сами задачи не изменятся.'
        }
        confirmLabel="Удалить вид"
        danger
      />
    </>
  );
}
