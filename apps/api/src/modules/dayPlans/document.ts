import { docToText, sanitizeDoc, type RichDoc, type RichNode } from '@flowdesk/contracts';
import { badRequest } from '../../lib/errors';

export function cleanPlan(input: unknown): RichDoc {
  const nodes = [{ value: input, depth: 0 }];
  let size = 0;
  while (nodes.length) {
    const { value, depth } = nodes.pop()!;
    size += typeof value === 'string' ? value.length + 1 : 1;
    if (depth > 40 || size > 48_000) {
      throw badRequest('План слишком длинный или содержит слишком много вложенных списков');
    }
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) nodes.push({ value: child, depth: depth + 1 });
    }
  }

  const withoutImages = (node: RichNode): RichNode => node.content
    ? { ...node, content: node.content.filter((child) => child.type !== 'image').map(withoutImages) }
    : { ...node };
  return withoutImages(sanitizeDoc(input)) as RichDoc;
}

export function normalizeMentions(node: RichNode, names: Map<string, string>): void {
  if (node.type === 'mention') {
    const label = names.get(String(node.attrs?.id ?? ''));
    if (label) {
      node.attrs = { id: node.attrs?.id, label };
    } else {
      // A member may leave the workspace between drafting and publishing.
      node.type = 'text';
      node.text = `@${String(node.attrs?.label ?? '')}`;
      delete node.attrs;
    }
  }
  node.content?.forEach((child) => normalizeMentions(child, names));
}

const CLOCK = /(?:^|\D)\d{1,2}[:.]\d{2}(?!\d)/;
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

/** Keeps headings and the text introducing a list with its mentioned items. */
export function mentionedLines(doc: RichDoc): Map<string, string[]> {
  const result = new Map<string, string[]>();

  function walk(blocks: RichNode[], parents: string[], insideItem = false) {
    let heading = '';
    let previous = '';
    for (const block of blocks) {
      if (LISTS.has(block.type) || block.type === 'blockquote') {
        const context = [...parents, heading, previous].filter(Boolean);
        walk(block.content ?? [], context);
        previous = '';
        continue;
      }
      if (block.type === 'listItem' || block.type === 'taskItem') {
        walk(block.content ?? [], parents, true);
        continue;
      }

      const parts: RichNode[][] = [[]];
      for (const child of block.content ?? []) {
        if (child.type === 'hardBreak') parts.push([]);
        else parts.at(-1)!.push(child);
      }
      for (const part of parts) {
        const text = docToText({ type: 'paragraph', content: part }).replace(/\s+/g, ' ');
        if (!text) continue;
        if (block.type === 'heading') {
          heading = text;
          previous = '';
        }
        const context = block.type === 'heading' ? parents : [...parents, heading];
        const line = [...new Set([...context, text].filter(Boolean))].join(' · ');
        for (const child of part) {
          const id = child.type === 'mention' ? child.attrs?.id : null;
          if (typeof id !== 'string') continue;
          const lines = result.get(id) ?? [];
          if (!lines.includes(line)) lines.push(line);
          result.set(id, lines);
        }
        if (block.type !== 'heading') previous = insideItem || CLOCK.test(text) || text.endsWith(':') ? text : '';
      }
    }
  }

  walk(doc.content ?? [], []);
  return result;
}

export function notificationExcerpt(lines: string[]): string {
  const full = lines.map((line) => `• ${line}`).join('\n');
  return full.length <= 2400 ? full : `${full.slice(0, 2399)}…`;
}
