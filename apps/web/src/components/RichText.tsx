import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { EditorContent, useEditor, type Editor, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import tippy, { type Instance } from 'tippy.js';
import type { RichNode, UserSummaryDto } from '@flowdesk/contracts';
import { EMPTY_DOC } from '@flowdesk/contracts';
import {
  Bold,
  Code,
  Code2,
  Heading2,
  ImagePlus,
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
      <div className="border-2 border-border-strong bg-surface p-2 text-xs text-text-subtle shadow-lg">
        Нет совпадений
      </div>
    );
  }

  return (
    <div className="max-h-56 w-56 overflow-y-auto border-2 border-border-strong bg-surface p-1 shadow-lg scrollbar-thin">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onClick={() => command({ id: item.id, label: item.name })}
          className={clsx(
            'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm',
            i === index ? 'bg-surface-active' : 'hover:bg-surface-hover',
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
    // Pictures are task files shown in place: the source is the file's own
    // address, never inline base64 that would bloat every saved description.
    Image.configure({ allowBase64: false, HTMLAttributes: { class: 'fd-image' } }),
  ];
}

/** Image files among those pasted or dropped; anything else is left to the editor. */
function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
}

/**
 * Rewrites picture sources in a document: a source found in `sources` is
 * replaced, and a `blob:` picture that is not — one that never made it to the
 * server — is dropped rather than saved as a broken image.
 */
export function replaceImageSources(doc: unknown, sources: Map<string, string>): unknown {
  const walk = (node: RichNode): RichNode | null => {
    if (node.type === 'image') {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
      const next = sources.get(src);
      if (next) return { ...node, attrs: { ...node.attrs, src: next } };
      return src.startsWith('blob:') ? null : node;
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(walk).filter((n): n is RichNode => n !== null) };
  };
  return doc && typeof doc === 'object' ? walk(doc as RichNode) : doc;
}

export interface RichTextEditorProps {
  value: unknown;
  onChange?: (value: unknown) => void;
  onBlur?: (value: unknown) => void;
  /** Called with the current document when the editor takes focus. */
  onFocus?: (value: unknown) => void;
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
  /**
   * Stores a pasted, dropped or picked picture and resolves to its address
   * (null when it failed — the caller has already said why). Without it the
   * editor takes no pictures.
   */
  onUploadImage?: (file: File) => Promise<string | null>;
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  onFocus,
  placeholder = 'Напишите что-нибудь…',
  users = [],
  editable = true,
  minHeight = '5rem',
  autoFocus,
  className,
  toolbar = true,
  footer,
  onSubmit,
  onUploadImage,
}: RichTextEditorProps) {
  // Suggestion callbacks capture this ref so the member list can change
  // without recreating the editor instance.
  const usersRef = useMemo(() => ({ current: users }), []);
  usersRef.current = users;

  // Paste and drop handlers are fixed when the editor is built; refs keep them
  // pointing at the current uploader and editor.
  const uploadRef = useRef(onUploadImage);
  uploadRef.current = onUploadImage;
  const editorRef = useRef<Editor | null>(null);
  const [uploading, setUploading] = useState(0);

  const insertImages = async (files: File[], at?: number) => {
    const upload = uploadRef.current;
    if (!upload) return;
    setUploading((n) => n + files.length);
    for (const file of files) {
      const src = await upload(file).catch(() => null);
      setUploading((n) => n - 1);
      const instance = editorRef.current;
      if (!src || !instance || instance.isDestroyed) continue;
      const image = { type: 'image', attrs: { src, alt: file.name } };
      // The document may have changed while the file was uploading.
      if (at === undefined) instance.chain().focus().insertContent(image).run();
      else instance.chain().focus().insertContentAt(Math.min(at, instance.state.doc.content.size), image).run();
    }
  };

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
      // A screenshot pasted with Ctrl+V or a picture dragged in goes straight
      // into the text — the most common way a bug gets described.
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length || !uploadRef.current) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (moved || !files.length || !uploadRef.current) return false;
        event.preventDefault();
        void insertImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => onChange?.(instance.getJSON()),
    onFocus: ({ editor: instance }) => onFocus?.(instance.getJSON()),
    onBlur: ({ editor: instance }) => onBlur?.(instance.getJSON()),
  });
  editorRef.current = editor;

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

  if (!editor) return <div className="h-20 animate-shimmer border-2 border-border-strong bg-surface-active" />;

  return (
    <div
      className={clsx(
        'fd-editor border-2 border-border-strong bg-surface transition-colors',
        'focus-within:border-accent focus-within:shadow-sm focus-within:-translate-x-px focus-within:-translate-y-px',
        !editable && 'border-transparent bg-transparent',
        className,
      )}
    >
      {toolbar && editable && (
        <EditorToolbar
          editor={editor}
          uploading={uploading > 0}
          onPickImages={onUploadImage ? (files) => void insertImages(files) : undefined}
        />
      )}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
      {footer && <div className="border-t-2 border-border-strong bg-surface-raised px-3 py-2">{footer}</div>}
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
          'inline-flex size-6 items-center justify-center border-2 transition-colors',
          active ? 'border-accent-border bg-accent-subtle text-accent' : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function EditorToolbar({
  editor,
  uploading,
  onPickImages,
}: {
  editor: Editor;
  uploading: boolean;
  onPickImages?: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    <div className="flex flex-wrap items-center gap-0.5 border-b-2 border-border-strong bg-surface-raised px-2 py-1">
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

      <span className="mx-1 h-4 w-px bg-border-strong" />

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

      <span className="mx-1 h-4 w-px bg-border-strong" />

      <ToolbarButton label="Ссылка" active={editor.isActive('link')} onClick={setLink}>
        <Link2 className="size-3.5" />
      </ToolbarButton>

      {onPickImages && (
        <>
          <ToolbarButton label="Картинка — или вставьте её через Ctrl+V" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus className="size-3.5" />
          </ToolbarButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = imageFiles(event.target.files);
              if (files.length) onPickImages(files);
              event.target.value = '';
            }}
          />
        </>
      )}

      <span className="ml-auto text-2xs text-text-subtle">
        {uploading ? 'Загружаем картинку…' : 'Введите @ для упоминания'}
      </span>
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
