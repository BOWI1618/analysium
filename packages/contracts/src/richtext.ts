/**
 * Rich text is stored as ProseMirror/TipTap JSON, never as HTML — the client
 * renders it through TipTap's schema, so there is no HTML string that could
 * carry an injected <script>. The server still validates the document against
 * an allow-list of node/mark types (`sanitizeDoc`) because the client is not
 * trusted, and derives a plain-text projection for search.
 */

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface RichDoc extends RichNode {
  type: 'doc';
  content?: RichNode[];
}

export const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'blockquote',
  'horizontalRule',
  'hardBreak',
  'mention',
  'image',
]);

export const ALLOWED_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link', 'underline']);

const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;

export const EMPTY_DOC: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Strips unknown nodes/marks and unsafe link targets. Returns a fresh object;
 * the input is never mutated.
 */
export function sanitizeDoc(input: unknown): RichDoc {
  if (!input || typeof input !== 'object') return EMPTY_DOC;
  const node = input as RichNode;
  if (node.type !== 'doc') return EMPTY_DOC;
  const cleaned = sanitizeNode(node);
  if (!cleaned || !cleaned.content?.length) return EMPTY_DOC;
  return cleaned as RichDoc;
}

function sanitizeNode(node: RichNode): RichNode | null {
  if (!node || typeof node.type !== 'string' || !ALLOWED_NODES.has(node.type)) return null;

  const out: RichNode = { type: node.type };

  if (node.type === 'text') {
    if (typeof node.text !== 'string') return null;
    out.text = node.text;
  }

  if (node.attrs && typeof node.attrs === 'object') {
    out.attrs = sanitizeAttrs(node.type, node.attrs);
  }

  if (Array.isArray(node.marks)) {
    type Mark = { type: string; attrs?: Record<string, unknown> };
    const marks: Mark[] = [];
    for (const mark of node.marks) {
      if (!mark || typeof mark.type !== 'string' || !ALLOWED_MARKS.has(mark.type)) continue;
      if (mark.type === 'link') {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        if (!SAFE_URL.test(href)) continue;
        marks.push({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } });
        continue;
      }
      marks.push({ type: mark.type });
    }
    if (marks.length) out.marks = marks;
  }

  if (Array.isArray(node.content)) {
    const content = node.content
      .map(sanitizeNode)
      .filter((n): n is RichNode => n !== null);
    if (content.length) out.content = content;
  }

  return out;
}

function sanitizeAttrs(type: string, attrs: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case 'heading': {
      const level = Number(attrs.level);
      return { level: level >= 1 && level <= 3 ? level : 1 };
    }
    case 'codeBlock':
      return { language: typeof attrs.language === 'string' ? attrs.language.slice(0, 24) : null };
    case 'taskItem':
      return { checked: attrs.checked === true };
    case 'orderedList':
      return { start: Number.isFinite(Number(attrs.start)) ? Number(attrs.start) : 1 };
    case 'mention':
      return {
        id: typeof attrs.id === 'string' ? attrs.id.slice(0, 40) : '',
        label: typeof attrs.label === 'string' ? attrs.label.slice(0, 80) : '',
      };
    case 'image': {
      const src = typeof attrs.src === 'string' ? attrs.src : '';
      return { src: SAFE_URL.test(src) ? src : '', alt: typeof attrs.alt === 'string' ? attrs.alt.slice(0, 200) : '' };
    }
    default:
      return {};
  }
}

/** Flattens a document to plain text — used for search indexing and previews. */
export function docToText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: RichNode | undefined) => {
    if (!node) return;
    if (node.type === 'text' && node.text) parts.push(node.text);
    if (node.type === 'mention' && typeof node.attrs?.label === 'string') parts.push(`@${node.attrs.label}`);
    if (node.type === 'hardBreak') parts.push(' ');
    node.content?.forEach(walk);
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'taskItem'].includes(node.type)) {
      parts.push('\n');
    }
  };
  walk(doc as RichNode);
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}

/** Collects user ids referenced by `mention` nodes. */
export function collectMentions(doc: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: RichNode | undefined) => {
    if (!node) return;
    if (node.type === 'mention' && typeof node.attrs?.id === 'string' && node.attrs.id) {
      ids.add(node.attrs.id);
    }
    node.content?.forEach(walk);
  };
  walk(doc as RichNode);
  return [...ids];
}

export function isDocEmpty(doc: unknown): boolean {
  return docToText(doc).length === 0;
}
