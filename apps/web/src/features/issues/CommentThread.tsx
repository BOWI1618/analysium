import { useState } from 'react';
import type { CommentDto, UserSummaryDto } from '@flowdesk/contracts';
import { EMPTY_DOC, isDocEmpty } from '@flowdesk/contracts';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Avatar } from '~/ui/Avatar';
import { Button, IconButton } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '~/ui/Menu';
import { ConfirmDialog } from '~/ui/Dialog';
import { EmptyState, SkeletonText } from '~/ui/Feedback';
import { Kbd } from '~/ui/Tooltip';
import { relativeTime, fullDate } from '~/lib/format';
import { RichTextEditor, RichTextViewer } from '~/components/RichText';
import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from '~/features/comments/hooks';

export function CommentThread({
  issueId,
  members,
  canComment,
  currentUser,
}: {
  issueId: string;
  members: UserSummaryDto[];
  canComment: boolean;
  currentUser: UserSummaryDto;
}) {
  const { data: comments, isLoading, error } = useComments(issueId);
  const createComment = useCreateComment(issueId);
  const [draft, setDraft] = useState<unknown>(EMPTY_DOC);
  const [draftKey, setDraftKey] = useState(0);

  const submit = async () => {
    if (isDocEmpty(draft) || createComment.isPending) return;
    await createComment.mutateAsync(draft);
    setDraft(EMPTY_DOC);
    // Remounting the editor is the reliable way to clear ProseMirror state.
    setDraftKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      {isLoading ? (
        <SkeletonText lines={4} />
      ) : error ? (
        <p className="text-sm text-danger">Не удалось загрузить комментарии.</p>
      ) : comments && comments.length > 0 ? (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} issueId={issueId} members={members} />
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          title="Комментариев пока нет"
          description={canComment ? 'Начните обсуждение ниже.' : 'Здесь пока ничего не обсуждали.'}
        />
      )}

      {canComment && (
        <div className="flex gap-2.5 pt-1">
          <Avatar user={currentUser} size="lg" className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <RichTextEditor
              key={draftKey}
              value={draft}
              onChange={setDraft}
              users={members}
              placeholder="Оставьте комментарий… (@ — упоминание, ⌘↵ — отправить)"
              minHeight="3.5rem"
              onSubmit={() => void submit()}
              footer={
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-2xs text-text-subtle">
                    <Kbd>⌘</Kbd>
                    <Kbd>↵</Kbd> to send
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={createComment.isPending}
                    disabled={isDocEmpty(draft)}
                    onClick={() => void submit()}
                  >
                    Отправить
                  </Button>
                </div>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  issueId,
  members,
}: {
  comment: CommentDto;
  issueId: string;
  members: UserSummaryDto[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateComment = useUpdateComment(issueId);
  const deleteComment = useDeleteComment(issueId);

  const save = async () => {
    if (isDocEmpty(draft)) return;
    await updateComment.mutateAsync({ commentId: comment.id, body: draft });
    setEditing(false);
  };

  return (
    <li className="flex gap-2.5">
      <Avatar user={comment.author} size="lg" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">{comment.author.name}</span>
          <time
            dateTime={comment.createdAt}
            title={fullDate(comment.createdAt)}
            className="text-xs text-text-subtle"
          >
            {relativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && <span className="text-2xs text-text-subtle">(изменён)</span>}

          {(comment.canEdit || comment.canDelete) && !editing && (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Действия с комментарием" size="xs" className="ml-auto">
                  <MoreHorizontal className="size-3.5" />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end" width={160} label="Действия с комментарием">
                {comment.canEdit && (
                  <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEditing(true)}>
                    Изменить
                  </MenuItem>
                )}
                {comment.canDelete && (
                  <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => setConfirmDelete(true)}>
                    Удалить
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5">
            <RichTextEditor
              value={draft}
              onChange={setDraft}
              users={members}
              autoFocus
              minHeight="3rem"
              onSubmit={() => void save()}
              footer={
                <div className="flex justify-end gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setDraft(comment.body);
                      setEditing(false);
                    }}
                  >
                    Отмена
                  </Button>
                  <Button size="xs" variant="primary" loading={updateComment.isPending} onClick={() => void save()}>
                    Сохранить
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <div className="mt-1 rounded-lg bg-surface-sunken px-3 py-2">
            <RichTextViewer value={comment.body} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteComment.mutate(comment.id);
          setConfirmDelete(false);
        }}
        title="Удалить комментарий?"
        message="Это действие нельзя отменить."
        confirmLabel="Удалить"
        danger
      />
    </li>
  );
}
