import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { EditorContent, useEditor, type Editor, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Mention from '@tiptap/extension-mention';
import tippy, { type Instance } from 'tippy.js';
import type { UserSummaryDto } from '@flowdesk/contracts';
import { EMPTY_DOC } from '@flowdesk/contracts';
import {
  Bold,
  Code,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Strikethrough,
} from 'lucide-react';
import { Avatar } from '~/ui/Avatar';
import { Tooltip } from '~/ui/Tooltip';

/**
 * Rich text is stored and exchanged as ProseMirror JSON — never HTML — so
 * there is no untrusted markup to sanitize on render. The server independently
 * validates the document against an allow-list before saving.
 */

/* ------------------------------------------------------------- mentions */

interface MentionListProps {
  items: UserSummaryDto[];
  command: (item: { id: string; label: string }) => void;
}

function MentionList({ items, command }: MentionListProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [items]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setIndex((i) => (i + 1) % Math.max(items.length, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1));
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const item = items[index];
        if (item) command({ id: item.id, label: item.name });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [items, index, command]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-text-subtle shadow-lg">
        No matching people
      </div>
    );
  }

  return (
    <div className="max-h-56 w-56 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 shadow-lg scrollbar-thin">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onClick={() => command({ id: item.id, label: item.name })}
          className={clsx(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
            i === index ? 'bg-surface-hover' : 'hover:bg-surface-hover',
          )}
        >
          <Avatar user={item} size="sm" />
          <span className="truncate">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

function createMentionSuggestion(getUsers: () => UserSummaryDto[]) {
  return {
    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      return getUsers()
        .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
        .slice(0, 6);
    },
    render: () => {
      let component: ReactRenderer<unknown, MentionListProps> | null = null;
      let popup: Instance[] | null = null;

      return {
        onStart: (props: { editor: Editor; clientRect?: (() => DOMRect | null) | null } & MentionListProps) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
          if (!props.clientRect) return;
          popup = tippy('body', {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          });
        },
        onUpdate: (props: MentionListProps & { clientRect?: (() => DOMRect | null) | null }) => {
          component?.updateProps(props);
          if (props.clientRect) {
            popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
          }
        },
        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === 'Escape') {
            popup?.[0]?.hide();
            return true;
          }
          return ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(props.event.key);
        },
        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}

/* --------------------------------------------------------------- editor */

function buildExtensions(placeholder: string, getUsers: () => UserSummaryDto[]) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { class: 'fd-code-block' } },
      // The editor is embedded in dialogs and panels — a horizontal rule adds
      // nothing there, and dropping it keeps the toolbar honest.
      horizontalRule: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Placeholder.configure({ placeholder }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Mention.configure({
      HTMLAttributes: { class: 'fd-mention' },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      suggestion: createMentionSuggestion(getUsers),
    }),
  ];
}

export interface RichTextEditorProps {
  value: unknown;
  onChange?: (value: unknown) => void;
  onBlur?: (value: unknown) => void;
  placeholder?: string;
  users?: UserSummaryDto[];
  editable?: boolean;
  minHeight?: string;
  autoFocus?: boolean;
  className?: string;
  toolbar?: boolean;
  footer?: ReactNode;
  /** Cmd/Ctrl+Enter — used by the comment composer to submit. */
  onSubmit?: () => void;
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder = 'Напишите что-нибудь…',
  users = [],
  editable = true,
  minHeight = '5rem',
  autoFocus,
  className,
  toolbar = true,
  footer,
  onSubmit,
}: RichTextEditorProps) {
  // Suggestion callbacks capture this ref so the member list can change
  // without recreating the editor instance.
  const usersRef = useMemo(() => ({ current: users }), []);
  usersRef.current = users;

  const editor = useEditor({
    extensions: buildExtensions(placeholder, () => usersRef.current),
    content: (value as object) ?? EMPTY_DOC,
    editable,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'fd-prose focus:outline-none',
        'data-editor': 'true',
        style: `min-height:${minHeight}`,
      },
      handleKeyDown: (_view, event) => {
        if (onSubmit && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          onSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => onChange?.(instance.getJSON()),
    onBlur: ({ editor: instance }) => onBlur?.(instance.getJSON()),
  });

  // Sync external changes (a realtime update, or switching issues) without
  // clobbering what the user is typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(value ?? EMPTY_DOC);
    // `false` suppresses the update event so syncing does not echo back as an edit.
    if (current !== next) editor.commands.setContent((value as object) ?? EMPTY_DOC, false);
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return <div className="h-20 animate-shimmer rounded-md bg-surface-active" />;

  return (
    <div
      className={clsx(
        'fd-editor rounded-lg border border-border bg-surface transition-colors',
        'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
        !editable && 'border-transparent bg-transparent',
        className,
      )}
    >
      {toolbar && editable && <EditorToolbar editor={editor} />}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
      {footer && <div className="border-t border-border px-3 py-2">{footer}</div>}
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={clsx(
          'inline-flex size-6 items-center justify-center rounded-sm transition-colors',
          active ? 'bg-accent-subtle text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Ссылка', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      window.alert('Ссылка должна начинаться с http://, https:// или mailto:');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
      <ToolbarButton label="Полужирный" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Курсив" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Зачёркнутый"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Код" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="size-3.5" />
      </ToolbarButton>

      <span className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton
        label="Заголовок"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Маркированный список"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Нумерованный список"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Чек-лист"
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Цитата"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Блок кода"
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="size-3.5" />
      </ToolbarButton>

      <span className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton label="Ссылка" active={editor.isActive('link')} onClick={setLink}>
        <Link2 className="size-3.5" />
      </ToolbarButton>

      <span className="ml-auto text-2xs text-text-subtle">Введите @ для упоминания</span>
    </div>
  );
}

/* --------------------------------------------------------------- viewer */

/** Read-only renderer. Uses the same schema as the editor, so nothing drifts. */
export function RichTextViewer({ value, className }: { value: unknown; className?: string }) {
  const editor = useEditor(
    {
      extensions: buildExtensions('', () => []),
      content: (value as object) ?? EMPTY_DOC,
      editable: false,
    },
    [value],
  );

  if (!editor) return null;
  return <EditorContent editor={editor} className={clsx('fd-prose', className)} />;
}
