import { useRef, useState } from 'react';
import clsx from 'clsx';
import type { CommentDto, CommentQuoteDto, UserSummaryDto } from '@flowdesk/contracts';
import { COMMENT_REACTIONS, EMPTY_DOC, isDocEmpty } from '@flowdesk/contracts';
import { CornerUpLeft, MoreHorizontal, Pencil, SmilePlus, Trash2, X } from 'lucide-react';
import { Popover } from '~/ui/Popover';
import { Avatar } from '~/ui/Avatar';
import { Button, IconButton } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '~/ui/Menu';
import { ConfirmDialog, useUnsavedChanges } from '~/ui/Dialog';
import { EmptyState, SkeletonText } from '~/ui/Feedback';
import { relativeTime, fullDate } from '~/lib/format';
import { RichTextEditor, RichTextViewer } from '~/components/RichText';
import { Shortcut } from '~/ui/Shortcut';
import { SHORTCUTS, comboText } from '~/lib/shortcuts';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useToggleReaction,
  useUpdateComment,
} from '~/features/comments/hooks';

export function CommentThread({
  issueId,
  members,
  canComment,
  currentUser,
  onUploadImage,
}: {
  issueId: string;
  members: UserSummaryDto[];
  canComment: boolean;
  currentUser: UserSummaryDto;
  /** Stores a picture put into a comment; absent when the person may not upload. */
  onUploadImage?: (file: File) => Promise<string | null>;
}) {
  const { data: comments, isLoading, error } = useComments(issueId);
  const createComment = useCreateComment(issueId);
  const [draft, setDraft] = useState<unknown>(EMPTY_DOC);
  const [draftKey, setDraftKey] = useState(0);
  const [replyTo, setReplyTo] = useState<CommentDto | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useUnsavedChanges(!isDocEmpty(draft));

  // The composer is the one below the list: an answer is written there, with
  // the comment it answers named above it, as in a messenger.
  const answer = (comment: CommentDto) => {
    setReplyTo(comment);
    // A new editor takes the focus and keeps what was already typed.
    setDraftKey((k) => k + 1);
    composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const submit = async () => {
    if (isDocEmpty(draft) || createComment.isPending) return;
    try {
      // An original deleted meanwhile is gone from the list too: the answer goes as a plain comment.
      const answered = replyTo && comments?.some((comment) => comment.id === replyTo.id) ? replyTo.id : undefined;
      await createComment.mutateAsync({ body: draft, replyToId: answered });
      setReplyTo(null);
      setDraft(EMPTY_DOC);
      // Remounting the editor is the reliable way to clear ProseMirror state.
      setDraftKey((k) => k + 1);
    } catch {
      // The mutation hook already showed the error as a toast.
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? (
        <SkeletonText lines={4} />
      ) : error ? (
        <p className="text-sm text-danger">Не удалось загрузить комментарии.</p>
      ) : comments && comments.length > 0 ? (
        <ul aria-label="Комментарии" className="space-y-4">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              issueId={issueId}
              members={members}
              onUploadImage={onUploadImage}
              canReact={canComment}
              viewerName={currentUser.name}
              onReply={canComment ? () => answer(comment) : undefined}
            />
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
        <div ref={composerRef} className="flex gap-2.5 pt-1">
          <Avatar user={currentUser} size="lg" className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            {replyTo && (
              <div
                role="status"
                className="mb-1.5 flex items-start gap-2 border-2 border-l-4 border-border-strong border-l-accent bg-surface-sunken px-2 py-1.5"
              >
                <CornerUpLeft className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-bold">Ответ: {replyTo.author.name}</p>
                  <p className="truncate text-text-muted">{quoteText(replyTo)}</p>
                </div>
                <IconButton label="Не отвечать на комментарий" size="xs" onClick={() => setReplyTo(null)}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
            )}
            <RichTextEditor
              key={draftKey}
              autoFocus={draftKey > 0 && replyTo !== null}
              value={draft}
              onChange={setDraft}
              users={members}
              placeholder={`Оставьте комментарий… (@ — упоминание, ${comboText(SHORTCUTS.submit)} — отправить)`}
              minHeight="3.5rem"
              onSubmit={() => void submit()}
              onUploadImage={onUploadImage}
              footer={
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-2xs text-text-subtle">
                    <Shortcut combo={SHORTCUTS.submit} /> отправить
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

/** How a comment begins, for a quote of it: its text as the server keeps it, or the element on screen. */
function quoteText(comment: CommentDto): string {
  const shown = document.getElementById(`comment-${comment.id}`)?.querySelector('[data-comment-body]')?.textContent;
  return (shown ?? '').trim().slice(0, 200) || 'Комментарий';
}

/** The comment answered, above the answer: who wrote it and how it began; a press goes to it. */
function Quote({ quote }: { quote: CommentQuoteDto }) {
  const goTo = () => {
    const target = document.getElementById(`comment-${quote.id}`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('bg-marker-subtle');
    window.setTimeout(() => target.classList.remove('bg-marker-subtle'), 1600);
  };
  return (
    <button
      type="button"
      onClick={goTo}
      title="Перейти к комментарию"
      className="mt-1 block w-full border-l-4 border-accent bg-surface px-2 py-1 text-left text-xs hover:bg-surface-hover"
    >
      <span className="block font-bold">{quote.author.name}</span>
      <span className="line-clamp-2 break-words text-text-muted">{quote.text || 'Вложение'}</span>
    </button>
  );
}

function CommentItem({
  comment,
  issueId,
  members,
  onUploadImage,
  canReact,
  viewerName,
  onReply,
}: {
  comment: CommentDto;
  issueId: string;
  members: UserSummaryDto[];
  onUploadImage?: (file: File) => Promise<string | null>;
  /** Reactions are put by whoever may comment; everyone else sees them. */
  canReact: boolean;
  viewerName: string;
  /** Present for those who may comment. */
  onReply?: () => void;
}) {
  const toggleReaction = useToggleReaction(issueId, viewerName);
  const react = (emoji: string) => toggleReaction.mutate({ commentId: comment.id, emoji });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateComment = useUpdateComment(issueId);
  const deleteComment = useDeleteComment(issueId);

  const save = async () => {
    if (isDocEmpty(draft)) return;
    try {
      await updateComment.mutateAsync({ commentId: comment.id, body: draft });
      setEditing(false);
    } catch {
      // The mutation hook already showed the error as a toast.
    }
  };

  return (
    <li id={`comment-${comment.id}`} className="flex gap-2.5 transition-colors">
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
              <MenuTrigger>
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
              onUploadImage={onUploadImage}
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
            {comment.replyTo && <Quote quote={comment.replyTo} />}
            <div data-comment-body className={clsx(comment.replyTo && 'mt-1.5')}>
              <RichTextViewer value={comment.body} />
            </div>
          </div>
        )}

        {/* Reactions, as in a messenger: a press puts one's own on or takes it off. */}
        {!editing && (comment.reactions.length > 0 || canReact || onReply) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1" role="group" aria-label="Реакции">
            {comment.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                disabled={!canReact}
                aria-pressed={reaction.mine}
                aria-label={`${reaction.emoji} ${reaction.count}: ${reaction.users.join(', ')}`}
                title={reaction.users.join(', ')}
                onClick={() => react(reaction.emoji)}
                className={clsx(
                  'inline-flex h-6 items-center gap-1 border-2 px-1.5 text-xs disabled:cursor-default',
                  reaction.mine
                    ? 'border-accent bg-accent-subtle font-bold'
                    : 'border-border-strong bg-surface enabled:hover:bg-surface-hover',
                )}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span className="fd-num">{reaction.count}</span>
              </button>
            ))}
            {canReact && (
              <Popover
                width={196}
                label="Выбрать реакцию"
                trigger={({ toggle, open }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label="Добавить реакцию"
                    aria-expanded={open}
                    title="Добавить реакцию"
                    className="inline-flex size-6 items-center justify-center border-2 border-transparent text-text-subtle hover:border-border-strong hover:bg-surface-hover hover:text-text"
                  >
                    <SmilePlus className="size-3.5" />
                  </button>
                )}
              >
                {({ close }) => (
                  <div className="grid grid-cols-5 gap-1">
                    {COMMENT_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={`Реакция ${emoji}`}
                        aria-pressed={comment.reactions.some((reaction) => reaction.emoji === emoji && reaction.mine)}
                        onClick={() => {
                          react(emoji);
                          close();
                        }}
                        className="flex size-8 items-center justify-center border-2 border-transparent text-base hover:border-border-strong hover:bg-surface-hover aria-pressed:border-accent aria-pressed:bg-accent-subtle"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            )}
            {onReply && (
              <button
                type="button"
                onClick={onReply}
                className="inline-flex h-6 items-center gap-1 border-2 border-transparent px-1 text-xs text-text-subtle hover:border-border-strong hover:bg-surface-hover hover:text-text"
              >
                <CornerUpLeft className="size-3.5" />
                Ответить
              </button>
            )}
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
